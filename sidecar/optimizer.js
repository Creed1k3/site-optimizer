#!/usr/bin/env node
// sidecar/optimizer.js - ZIP or folder in -> optimize -> ZIP or folder out

import { readdir, stat, readFile, writeFile, unlink, mkdir, cp } from "fs/promises";
import { join, extname, relative, basename, dirname } from "path";
import { createRequire } from "module";
import { createHash } from "crypto";

const require = createRequire(import.meta.url);

let sharp, AdmZip;
try {
    sharp = require("sharp");
} catch {
    emit({ type: "error", message: toRussianError("sharp not installed. Run: npm install sharp") });
    process.exit(1);
}
try {
    AdmZip = require("adm-zip");
} catch {
    emit({ type: "error", message: toRussianError("adm-zip not installed. Run: npm install adm-zip") });
    process.exit(1);
}

const [, , command, arg1, arg2, ...extraArgs] = process.argv;

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

function toRussianError(message = "") {
    return String(message)
        .replace("sharp not installed. Run: npm install sharp", "Не установлен sharp. Выполни: npm install sharp")
        .replace("adm-zip not installed. Run: npm install adm-zip", "Не установлен adm-zip. Выполни: npm install adm-zip")
        .replace("Unknown command", "Неизвестная команда")
        .replace(/Skipped GIF -> WebP because output is larger \((\d+) -> (\d+) bytes\)/, "GIF пропущен: WebP получился больше ($1 -> $2 байт)")
        .replace(/EBUSY/g, "Файл занят другим процессом")
        .replace(/EPERM/g, "Нет прав на операцию")
        .replace(/ENOENT/g, "Файл или папка не найдены");
}

const CODE_EXTS = new Set([
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".js", ".ts", ".jsx", ".tsx", ".vue", ".svelte", ".astro",
    ".json", ".xml", ".svg",
    ".php", ".phtml", ".twig", ".liquid", ".njk", ".ejs",
    ".hbs", ".handlebars", ".mustache", ".tpl", ".tmpl"
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif"]);
const CONVERTIBLE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif"]);
const IMAGE_REF_RE = /(?:src|href|poster|content)\s*=\s*["']([^"']+\.(?:png|jpe?g|gif)(?:[?#][^"']*)?)["']|url\(\s*['"]?([^'")]+\.(?:png|jpe?g|gif)(?:[?#][^'")]+)?)['"]?\s*\)|(?:["'`(\s=:/\\]|^)([^"'`\s)]+?\.(?:png|jpe?g|gif)(?:[?#][^"'`\s)]*)?)/gi;

const isPng = filePath => extname(filePath).toLowerCase() === ".png";
const isJpg = filePath => [".jpg", ".jpeg"].includes(extname(filePath).toLowerCase());
const isGif = filePath => extname(filePath).toLowerCase() === ".gif";
const toWebpPath = filePath => filePath.replace(/\.(png|jpe?g|gif)$/i, ".webp");

function normalizeRef(ref) {
    return ref
        .split(/[?#]/, 1)[0]
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .toLowerCase();
}

function collectReferencedImages(content) {
    const refs = new Set();
    let match;
    IMAGE_REF_RE.lastIndex = 0;

    while ((match = IMAGE_REF_RE.exec(content)) !== null) {
        const raw = match[1] || match[2] || match[3];
        if (!raw) continue;
        const normalized = normalizeRef(raw);
        if (!normalized) continue;
        refs.add(normalized);
        refs.add(basename(normalized));
    }

    return refs;
}

async function walkDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", ".git", ".trash"].includes(entry.name)) continue;
            files.push(...await walkDir(full));
        } else {
            files.push(full);
        }
    }
    return files;
}

function stripResponsiveAttrs(content) {
    return content
        .replace(/\s+srcset\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
        .replace(/\s+imagesrcset\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
        .replace(/\s+sizes\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
}

function replaceImageRefs(content, exactRewrites, basenameRewrites) {
    return content.replace(/(?<full>(?<path>[^"'`\s)<>]+?)\.(?<ext>png|jpe?g|gif)(?<suffix>[?#][^"'`\s)]*)?)(?=$|["'`\s),>])/gi, (match, _full, _path, _ext, _suffix, _offset, _input, groups) => {
        const pathPart = groups?.path ?? "";
        const extPart = groups?.ext ?? "";
        const suffixPart = groups?.suffix ?? "";
        const normalized = normalizeRef(`${pathPart}.${extPart}`);
        const replacement = exactRewrites.get(normalized) ?? basenameRewrites.get(basename(normalized));
        if (!replacement) {
            return match;
        }
        return `${replacement}${suffixPart}`;
    });
}

function buildBasenameRewriteMap(exactRewrites) {
    const counts = new Map();
    for (const key of exactRewrites.keys()) {
        const name = basename(key);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const basenameRewrites = new Map();
    for (const [key, value] of exactRewrites.entries()) {
        const name = basename(key);
        if (counts.get(name) === 1) {
            basenameRewrites.set(name, value);
        }
    }

    return basenameRewrites;
}

function hashBuffer(buffer) {
    return createHash("sha1").update(buffer).digest("hex");
}

async function safeUnlink(filePath, retries = 6) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await unlink(filePath);
            return;
        } catch (error) {
            if ((error?.code !== "EBUSY" && error?.code !== "EPERM") || attempt === retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
        }
    }
}

async function cmdUnzip(zipPath, workDir) {
    emit({ type: "status", message: "Extracting ZIP..." });
    await mkdir(workDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(workDir, true);
    const allFiles = await walkDir(workDir);
    const imgCount = allFiles.filter(filePath => IMAGE_EXTS.has(extname(filePath).toLowerCase())).length;
    emit({ type: "unzip_done", workDir, fileCount: allFiles.length, imgCount });
}

async function cmdOptimize(workDir) {
    const removeUnused = extraArgs.includes("--remove-unused");
    const dedupeImages = extraArgs.includes("--dedupe-images");

    emit({ type: "status", message: "Scanning files..." });

    const allFiles = await walkDir(workDir);
    const imgFiles = allFiles.filter(filePath => IMAGE_EXTS.has(extname(filePath).toLowerCase()));
    const convertibleFiles = imgFiles.filter(filePath => CONVERTIBLE_EXTS.has(extname(filePath).toLowerCase()));
    const gifFiles = imgFiles.filter(isGif);
    const codeFiles = allFiles.filter(filePath => CODE_EXTS.has(extname(filePath).toLowerCase()));

    emit({
        type: "scan_done",
        pngCount: convertibleFiles.filter(isPng).length,
        jpgCount: convertibleFiles.filter(isJpg).length,
        gifCount: gifFiles.length,
        imgCount: imgFiles.length,
        codeCount: codeFiles.length
    });

    if (convertibleFiles.length === 0) {
        emit({ type: "done", converted: 0, deleted: 0, replacedFiles: 0, savedBytes: 0, report: [] });
        return;
    }

    emit({ type: "status", message: "Analysing code references..." });
    const toConvert = convertibleFiles;
    const toDelete = [];
    const exactRewrites = new Map();

    emit({ type: "classify_done", toConvert: toConvert.length, toDelete: toDelete.length });

    const report = [];
    let savedBytes = 0;
    let done = 0;
    const total = toConvert.length + toDelete.length;

    const fmtSummary = [
        toConvert.filter(isPng).length ? `${toConvert.filter(isPng).length} PNG` : "",
        toConvert.filter(isJpg).length ? `${toConvert.filter(isJpg).length} JPG` : "",
        toConvert.filter(isGif).length ? `${toConvert.filter(isGif).length} GIF` : ""
    ].filter(Boolean).join(" + ");

    emit({ type: "status", message: `Converting ${fmtSummary || "0 files"} -> WebP...` });

    for (const imgPath of toConvert) {
        const rel = relative(workDir, imgPath);
        const out = toWebpPath(imgPath);
        try {
            const originalSize = (await stat(imgPath)).size;
            const inputBuffer = await readFile(imgPath);
            await sharp(inputBuffer, { animated: isGif(imgPath) }).webp({ quality: 82, effort: 4 }).toFile(out);
            const newSize = (await stat(out)).size;

            if (isGif(imgPath) && newSize >= originalSize) {
                await safeUnlink(out);
                report.push({
                    type: "error",
                    file: rel,
                    message: toRussianError(`Skipped GIF -> WebP because output is larger (${originalSize} -> ${newSize} bytes)`)
                });
                done++;
                emit({ type: "progress", done, total, percent: total ? Math.round((done / total) * 100) : 100, file: rel });
                continue;
            }

            const saved = originalSize - newSize;
            savedBytes += saved;
            await safeUnlink(imgPath);
            const relWebp = relative(workDir, out).replace(/\\/g, "/");
            exactRewrites.set(normalizeRef(rel), relWebp);
            report.push({
                type: "converted",
                file: rel,
                srcFormat: isPng(imgPath) ? "PNG" : isGif(imgPath) ? "GIF" : "JPG",
                originalSize,
                newSize,
                saved,
                savedPercent: Math.round((saved / originalSize) * 100)
            });
        } catch (err) {
            report.push({ type: "error", file: rel, message: toRussianError(err.message) });
        }
        done++;
        emit({ type: "progress", done, total, percent: total ? Math.round((done / total) * 100) : 100, file: rel });
    }

    if (dedupeImages) {
        emit({ type: "status", message: "Finding duplicate images..." });
        const currentFiles = await walkDir(workDir);
        const currentImages = currentFiles.filter(filePath => IMAGE_EXTS.has(extname(filePath).toLowerCase()) || extname(filePath).toLowerCase() === ".webp");
        const seenHashes = new Map();

        for (const imgPath of currentImages) {
            const rel = relative(workDir, imgPath).replace(/\\/g, "/");
            const buffer = await readFile(imgPath);
            const hash = hashBuffer(buffer);
            const original = seenHashes.get(hash);

            if (!original) {
                seenHashes.set(hash, { path: imgPath, rel, size: buffer.length });
                continue;
            }

            await safeUnlink(imgPath);
            exactRewrites.set(normalizeRef(rel), original.rel);
            report.push({
                type: "deleted",
                file: rel,
                srcFormat: extname(imgPath).slice(1).toUpperCase(),
                originalSize: buffer.length,
                message: `Дубликат объединен с ${original.rel}`
            });
        }
    }

    emit({ type: "status", message: "Updating code references..." });
    const basenameRewrites = buildBasenameRewriteMap(exactRewrites);
    let replacedFiles = 0;
    const finalReferencedImages = new Set();
    for (const codeFile of codeFiles) {
        const content = await readFile(codeFile, "utf8").catch(() => null);
        if (!content) continue;
        let updated = replaceImageRefs(content, exactRewrites, basenameRewrites);
        updated = stripResponsiveAttrs(updated);
        for (const ref of collectReferencedImages(updated)) {
            finalReferencedImages.add(ref);
        }
        if (updated !== content) {
            await writeFile(codeFile, updated, "utf8");
            replacedFiles++;
        }
    }

    if (removeUnused) {
        emit({ type: "status", message: "Removing unused images..." });
        const currentFiles = await walkDir(workDir);
        const currentImages = currentFiles.filter(filePath => IMAGE_EXTS.has(extname(filePath).toLowerCase()) || extname(filePath).toLowerCase() === ".webp");

        for (const imgPath of currentImages) {
            const rel = relative(workDir, imgPath).replace(/\\/g, "/");
            const normalizedRel = normalizeRef(rel);
            const normalizedName = basename(normalizedRel);
            if (finalReferencedImages.has(normalizedRel) || finalReferencedImages.has(normalizedName)) {
                continue;
            }

            const originalSize = (await stat(imgPath)).size;
            await safeUnlink(imgPath);
            report.push({
                type: "deleted",
                file: rel,
                srcFormat: extname(imgPath).slice(1).toUpperCase(),
                originalSize,
                message: "Не используется в коде"
            });
            savedBytes += originalSize;
        }
    }

    const deletedCount = report.filter(item => item.type === "deleted").length;
    const convertedCount = report.filter(item => item.type === "converted").length;
    emit({ type: "done", converted: convertedCount, deleted: deletedCount, replacedFiles, savedBytes, report });
}

async function cmdRezip(workDir, outputZipPath) {
    emit({ type: "status", message: "Packing ZIP..." });
    const zip = new AdmZip();
    const allFiles = await walkDir(workDir);
    for (const filePath of allFiles) {
        const rel = relative(workDir, filePath);
        const dirInZip = dirname(rel) === "." ? "" : dirname(rel);
        zip.addLocalFile(filePath, dirInZip);
    }
    zip.writeZip(outputZipPath);
    const finalSize = (await stat(outputZipPath)).size;
    emit({ type: "rezip_done", outputZipPath, finalSize });
}

async function cmdCopyOut(workDir, outputDir) {
    emit({ type: "status", message: "Copying to output folder..." });
    await mkdir(outputDir, { recursive: true });
    const allFiles = await walkDir(workDir);
    for (const filePath of allFiles) {
        const rel = relative(workDir, filePath);
        const dest = join(outputDir, rel);
        await mkdir(dirname(dest), { recursive: true });
        await cp(filePath, dest);
    }
    emit({ type: "copyout_done", outputDir });
}

(async() => {
    try {
        if (command === "unzip") await cmdUnzip(arg1, arg2);
        else if (command === "optimize") await cmdOptimize(arg1);
        else if (command === "rezip") await cmdRezip(arg1, arg2);
        else if (command === "copyout") await cmdCopyOut(arg1, arg2);
        else {
            emit({ type: "error", message: toRussianError(`Unknown command: ${command}`) });
            process.exit(1);
        }
    } catch (err) {
        emit({ type: "error", message: toRussianError(err.message) });
        process.exit(1);
    }
})();
