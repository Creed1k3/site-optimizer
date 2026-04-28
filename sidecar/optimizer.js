#!/usr/bin/env node
// sidecar/optimizer.js - ZIP or folder in -> optimize -> ZIP or folder out

import { readdir, stat, readFile, writeFile, unlink, mkdir, cp, rename } from "fs/promises";
import { join, extname, relative, basename, dirname, resolve, isAbsolute } from "path";
import { createRequire } from "module";
import { createHash } from "crypto";
import { spawn } from "child_process";

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
const VIDEO_EXTS = new Set([".mp4", ".ogv", ".webm"]);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ".webp"]);
const FONT_EXTS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const SCRIPT_ASSET_EXTS = new Set([".js", ".mjs", ".cjs"]);
const STYLE_ASSET_EXTS = new Set([".css"]);
const REMOVABLE_ASSET_EXTS = new Set([...MEDIA_EXTS, ...FONT_EXTS, ...SCRIPT_ASSET_EXTS, ...STYLE_ASSET_EXTS]);
const CONVERTIBLE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif"]);
const ASSET_REF_RE = /(?:src|href|poster|content|data-src|data-original|data-image|data-lazy-src|srcset|imagesrcset|data-srcset)\s*=\s*["']([^"']+\.(?:png|jpe?g|gif|webp|mp4|ogv|webm|woff2?|ttf|otf|eot|css|m?js|cjs)(?:[?#][^"']*)?)["']|url\(\s*['"]?([^'")]+\.(?:png|jpe?g|gif|webp|mp4|ogv|webm|woff2?|ttf|otf|eot|css|m?js|cjs)(?:[?#][^'")]+)?)['"]?\s*\)|(?:["'`(\s=:/\\,]|^)([^"'`\s),]+?\.(?:png|jpe?g|gif|webp|mp4|ogv|webm|woff2?|ttf|otf|eot|css|m?js|cjs)(?:[?#][^"'`\s),]*)?)/gi;

const isPng = filePath => extname(filePath).toLowerCase() === ".png";
const isJpg = filePath => [".jpg", ".jpeg"].includes(extname(filePath).toLowerCase());
const isGif = filePath => extname(filePath).toLowerCase() === ".gif";
const isMp4 = filePath => extname(filePath).toLowerCase() === ".mp4";
const isOgv = filePath => extname(filePath).toLowerCase() === ".ogv";
const isWebm = filePath => extname(filePath).toLowerCase() === ".webm";
const toWebpPath = filePath => filePath.replace(/\.(png|jpe?g|gif)$/i, ".webp");
const swapExtension = (filePath, nextExt) => filePath.replace(/\.[^.]+$/i, `.${nextExt}`);
const webpCollisionPath = filePath => {
    const ext = extname(filePath).toLowerCase().replace(".", "");
    return filePath.replace(/\.(png|jpe?g|gif)$/i, `-${ext}.webp`);
};
const mediaCollisionPath = (filePath, nextExt) => {
    const ext = extname(filePath).toLowerCase().replace(".", "");
    return filePath.replace(/\.[^.]+$/i, `-${ext}.${nextExt}`);
};

function defaultVideoAction(filePath) {
    if (isMp4(filePath)) return "mp4";
    if (isWebm(filePath)) return "webm";
    if (isOgv(filePath)) return "webm";
    return "keep";
}

function parseVideoActionOverrides() {
    const index = extraArgs.indexOf("--video-actions-json");
    if (index === -1 || !extraArgs[index + 1]) {
        return new Map();
    }

    try {
        const parsed = JSON.parse(extraArgs[index + 1]);
        if (!Array.isArray(parsed)) {
            return new Map();
        }

        return new Map(
            parsed
                .filter(item => item && typeof item.path === "string" && typeof item.action === "string")
                .map(item => [normalizeRef(item.path), String(item.action).toLowerCase()])
        );
    } catch {
        return new Map();
    }
}

function targetExtForVideoAction(action) {
    if (action === "mp4" || action === "webm" || action === "gif") {
        return action;
    }
    return null;
}

function normalizeRef(ref) {
    return ref
        .split(/[?#]/, 1)[0]
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .toLowerCase();
}

function isDynamicRef(ref = "") {
    return /\$\{[^}]+\}|\{\{[^}]+\}\}|<%[=%-]?[\s\S]+?%>|@\{[^}]+\}|\+\s*["'`]|["'`]\s*\+/.test(ref);
}

function resolveMediaRef(rawPath, codeFile, workDir, onSkip) {
    if (!rawPath) return null;
    if (isDynamicRef(rawPath)) {
        onSkip?.(rawPath, "Пропущена динамическая ссылка");
        return null;
    }
    if (/^(?:https?:)?\/\//i.test(rawPath) || rawPath.startsWith("data:")) {
        return null;
    }

    const pathOnly = rawPath.split(/[?#]/, 1)[0];
    if (!pathOnly) return null;

    if (pathOnly.startsWith("/")) {
        return normalizeRef(pathOnly.slice(1));
    }
    if (isAbsolute(pathOnly)) {
        return normalizeRef(relative(workDir, pathOnly));
    }
    return normalizeRef(relative(workDir, resolve(dirname(codeFile), pathOnly)));
}

function collectReferencedAssets(content, codeFile, workDir, onSkip) {
    const exactRefs = new Set();
    const unresolvedNames = new Set();
    let match;
    ASSET_REF_RE.lastIndex = 0;

    while ((match = ASSET_REF_RE.exec(content)) !== null) {
        const raw = match[1] || match[2] || match[3];
        if (!raw) continue;

        const resolved = resolveMediaRef(raw, codeFile, workDir, onSkip);
        if (!resolved) {
            const normalizedRaw = normalizeRef(raw);
            if (normalizedRaw) {
                unresolvedNames.add(basename(normalizedRaw));
            }
            continue;
        }

        exactRefs.add(resolved);
    }

    return { exactRefs, unresolvedNames };
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

function replaceImageRefs(content, codeFile, workDir, exactRewrites, onSkip) {
    const resolveReplacement = rawPath => {
        const [pathOnly, suffix = ""] = rawPath.split(/([?#].*)/, 2);
        const normalizedOriginal = normalizeRef(pathOnly);
        const normalizedResolved = resolveMediaRef(rawPath, codeFile, workDir, onSkip);

        const replacement = exactRewrites.get(normalizedResolved)
            ?? exactRewrites.get(normalizedOriginal);
        if (!replacement) {
            return null;
        }

        if (pathOnly.startsWith("/")) {
            return `/${replacement}${suffix}`;
        }

        const replacementAbs = resolve(workDir, replacement);
        let nextPath = relative(dirname(codeFile), replacementAbs).replace(/\\/g, "/");
        if (!nextPath || nextPath === "") {
            nextPath = basename(replacement);
        }
        return `${nextPath}${suffix}`;
    };

    let updated = content.replace(
        /((?:src|href|poster|content|data-src|data-original|data-image|data-lazy-src)\s*=\s*["'])([^"']+\.(?:png|jpe?g|gif|webp|mp4|ogv|webm)(?:[?#][^"']*)?)(["'])/gi,
        (match, prefix, rawPath, suffix) => {
            const replacement = resolveReplacement(rawPath);
            return replacement ? `${prefix}${replacement}${suffix}` : match;
        }
    );

    updated = updated.replace(
        /((?:srcset|imagesrcset|data-srcset)\s*=\s*["'])([^"']+)(["'])/gi,
        (match, prefix, rawList, suffix) => {
            const rewritten = rawList.replace(
                /([^,\s]+?\.(?:png|jpe?g|gif|webp|mp4|ogv|webm)(?:[?#][^,\s]+)?)(\s+\d+(?:\.\d+)?[wx])?/gi,
                (entryMatch, rawPath, descriptor = "") => {
                    const replacement = resolveReplacement(rawPath);
                    return replacement ? `${replacement}${descriptor}` : entryMatch;
                }
            );
            return `${prefix}${rewritten}${suffix}`;
        }
    );

    updated = updated.replace(
        /(url\(\s*['"]?)([^'")]+\.(?:png|jpe?g|gif|webp|mp4|ogv|webm)(?:[?#][^'")]+)?)(['"]?\s*\))/gi,
        (match, prefix, rawPath, suffix) => {
            const replacement = resolveReplacement(rawPath);
            return replacement ? `${prefix}${replacement}${suffix}` : match;
        }
    );

    updated = updated.replace(
        /((?:image-set|-webkit-image-set)\(\s*)([\s\S]*?)(\))/gi,
        (match, prefix, body, suffix) => {
            const rewritten = body.replace(
                /(url\(\s*['"]?)([^'")]+\.(?:png|jpe?g|gif|webp|mp4|ogv|webm)(?:[?#][^'")]+)?)(['"]?\s*\))/gi,
                (innerMatch, innerPrefix, rawPath, innerSuffix) => {
                    const replacement = resolveReplacement(rawPath);
                    return replacement ? `${innerPrefix}${replacement}${innerSuffix}` : innerMatch;
                }
            ).replace(
                /(^|[\s,])(['"]?)([^'",\s)]+?\.(?:png|jpe?g|gif|webp|mp4|ogv|webm)(?:[?#][^'",\s)]+)?)(\2)(?=\s+\d+(?:\.\d+)?x|[\s,)]|$)/gi,
                (innerMatch, lead, quote, rawPath, endQuote) => {
                    const replacement = resolveReplacement(rawPath);
                    return replacement ? `${lead}${quote}${replacement}${endQuote}` : innerMatch;
                }
            );
            return `${prefix}${rewritten}${suffix}`;
        }
    );

    updated = updated.replace(
        /((?:^|["'`(\s=:/\\]))([^"'`\s)<>]+?\.(?:png|jpe?g|gif|webp|mp4|ogv|webm)(?:[?#][^"'`\s)]*)?)(?=$|["'`\s),>])/gi,
        (match, prefix, rawPath) => {
            const replacement = resolveReplacement(rawPath);
            return replacement ? `${prefix}${replacement}` : match;
        }
    );

    return updated;
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

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";
        child.stderr.on("data", chunk => {
            stderr += String(chunk);
        });

        child.on("error", reject);
        child.on("close", code => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        });
    });
}

async function optimizeVideo(filePath, targetExt) {
    const extension = extname(filePath).toLowerCase();
    const tempPath = filePath.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), `.optimized.${targetExt}`);
    const baseArgs = ["-y", "-i", filePath, "-map_metadata", "-1"];
    let codecArgs;

    if (targetExt === "mp4") {
        codecArgs = ["-movflags", "+faststart", "-c:v", "libx264", "-preset", "medium", "-crf", "28", "-c:a", "aac", "-b:a", "128k"];
    } else if (targetExt === "webm") {
        codecArgs = ["-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-deadline", "good", "-cpu-used", "2", "-c:a", "libopus", "-b:a", "96k"];
    } else if (targetExt === "gif") {
        codecArgs = ["-map", "0:v:0", "-vf", "fps=10,scale='min(960,iw)':-1:flags=lanczos", "-loop", "0"];
    } else {
        throw new Error(`Unsupported target video format: ${targetExt}`);
    }

    const args = targetExt === "gif"
        ? [...baseArgs, ...codecArgs, tempPath]
        : [...baseArgs, "-map", "0:v:0", "-map", "0:a?", ...codecArgs, tempPath];

    await runFfmpeg(args);
    return tempPath;
}

function relativePath(workDir, filePath) {
    return relative(workDir, filePath).replace(/\\/g, "/");
}

function isReferencedAsset(filePath, workDir, exactRefs, unresolvedNames) {
    const rel = relativePath(workDir, filePath);
    const normalizedRel = normalizeRef(rel);
    const normalizedName = basename(normalizedRel);
    return exactRefs.has(normalizedRel) || unresolvedNames.has(normalizedName);
}

function planConvertedTarget(filePath, targetExt, workDir, existingTargets, reservedTargets) {
    if (!targetExt) {
        return null;
    }

    const desiredOut = targetExt === "webp" ? toWebpPath(filePath) : swapExtension(filePath, targetExt);
    const collisionOut = targetExt === "webp" ? webpCollisionPath(filePath) : mediaCollisionPath(filePath, targetExt);
    const desiredKey = normalizeRef(relativePath(workDir, desiredOut));
    if (existingTargets.has(desiredKey) || reservedTargets.has(desiredKey)) {
        const collisionKey = normalizeRef(relativePath(workDir, collisionOut));
        reservedTargets.add(collisionKey);
        return collisionOut;
    }

    reservedTargets.add(desiredKey);
    return desiredOut;
}

function canonicalWebpTargetExists(filePath, workDir, existingTargets) {
    const desiredOut = toWebpPath(filePath);
    const desiredKey = normalizeRef(relativePath(workDir, desiredOut));
    return existingTargets.has(desiredKey) ? desiredOut : null;
}

async function cmdUnzip(zipPath, workDir) {
    emit({ type: "status", message: "Extracting ZIP..." });
    await mkdir(workDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(workDir, true);
    const allFiles = await walkDir(workDir);
    const imgCount = allFiles.filter(filePath => IMAGE_EXTS.has(extname(filePath).toLowerCase()) || VIDEO_EXTS.has(extname(filePath).toLowerCase())).length;
    emit({ type: "unzip_done", workDir, fileCount: allFiles.length, imgCount });
}

async function cmdOptimize(workDir) {
    const removeUnused = extraArgs.includes("--remove-unused");
    const dedupeImages = extraArgs.includes("--dedupe-images");
    const videoActionOverrides = parseVideoActionOverrides();

    emit({ type: "status", message: "Scanning files..." });

    const allFiles = await walkDir(workDir);
    const imageFiles = allFiles.filter(filePath => IMAGE_EXTS.has(extname(filePath).toLowerCase()));
    const videoFiles = allFiles.filter(filePath => VIDEO_EXTS.has(extname(filePath).toLowerCase()));
    const removableAssetFiles = allFiles.filter(filePath => REMOVABLE_ASSET_EXTS.has(extname(filePath).toLowerCase()));
    const imgFiles = [...imageFiles, ...videoFiles];
    const convertibleFiles = imageFiles.filter(filePath => CONVERTIBLE_EXTS.has(extname(filePath).toLowerCase()));
    const gifFiles = imageFiles.filter(isGif);
    const allConvertibleFiles = [...convertibleFiles, ...videoFiles];
    const codeFiles = allFiles.filter(filePath => CODE_EXTS.has(extname(filePath).toLowerCase()));

    emit({
        type: "scan_done",
        pngCount: convertibleFiles.filter(isPng).length,
        jpgCount: convertibleFiles.filter(isJpg).length,
        gifCount: gifFiles.length,
        mp4Count: videoFiles.filter(isMp4).length,
        ogvCount: videoFiles.filter(isOgv).length,
        webmCount: videoFiles.filter(isWebm).length,
        imgCount: imgFiles.length,
        codeCount: codeFiles.length
    });

    if (allConvertibleFiles.length === 0 && !removeUnused) {
        emit({ type: "done", converted: 0, deleted: 0, replacedFiles: 0, savedBytes: 0, report: [] });
        return;
    }

    emit({ type: "status", message: "Analysing code references..." });
    const initialReferencedAssets = new Set();
    const unresolvedReferencedNames = new Set();

    for (const codeFile of codeFiles) {
        const content = await readFile(codeFile, "utf8").catch(() => null);
        if (!content) continue;
        const { exactRefs, unresolvedNames } = collectReferencedAssets(content, codeFile, workDir);
        for (const ref of exactRefs) initialReferencedAssets.add(ref);
        for (const name of unresolvedNames) unresolvedReferencedNames.add(name);
    }

    const usedConvertibleFiles = removeUnused
        ? convertibleFiles.filter(filePath => isReferencedAsset(filePath, workDir, initialReferencedAssets, unresolvedReferencedNames))
        : convertibleFiles;
    const usedVideoFiles = removeUnused
        ? videoFiles.filter(filePath => isReferencedAsset(filePath, workDir, initialReferencedAssets, unresolvedReferencedNames))
        : videoFiles;

    const imagePlans = usedConvertibleFiles.map(filePath => ({
        kind: "image",
        filePath,
        targetExt: "webp"
    }));
    const videoPlans = usedVideoFiles
        .map(filePath => {
            const relativeFilePath = relativePath(workDir, filePath);
            const overrideAction = videoActionOverrides.get(normalizeRef(relativeFilePath));
            const action = overrideAction ?? defaultVideoAction(filePath);
            return {
                kind: "video",
                filePath,
                action,
                explicit: overrideAction != null,
                targetExt: targetExtForVideoAction(action)
            };
        })
        .filter(plan => plan.action !== "keep");
    const toDelete = videoPlans.filter(plan => plan.action === "delete");
    const toConvert = [
        ...imagePlans,
        ...videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt)
    ];

    if (toConvert.length === 0 && toDelete.length === 0 && !removeUnused) {
        emit({ type: "done", converted: 0, deleted: 0, replacedFiles: 0, savedBytes: 0, report: [] });
        return;
    }

    const exactRewrites = new Map();
    const existingTargets = new Set(allFiles.map(filePath => normalizeRef(relativePath(workDir, filePath))));
    const reservedTargets = new Set();
    const plannedTargets = new Map();
    const aliasToExistingWebp = new Map();

    for (const plan of toConvert) {
        const currentExt = extname(plan.filePath).toLowerCase().replace(".", "");
        if (plan.targetExt === currentExt) {
            continue;
        }

        if (plan.kind === "image" && plan.targetExt === "webp") {
            const existingWebp = canonicalWebpTargetExists(plan.filePath, workDir, existingTargets);
            if (existingWebp && existingWebp !== plan.filePath) {
                aliasToExistingWebp.set(plan.filePath, existingWebp);
                continue;
            }
        }

        const targetPath = planConvertedTarget(plan.filePath, plan.targetExt, workDir, existingTargets, reservedTargets);
        if (targetPath) {
            plannedTargets.set(plan.filePath, targetPath);
        }
    }

    emit({ type: "classify_done", toConvert: toConvert.length, toDelete: toDelete.length });

    const report = [];
    let savedBytes = 0;
    let done = 0;
    const total = toConvert.length + toDelete.length;

    const fmtSummary = [
        imagePlans.filter(plan => isPng(plan.filePath)).length ? `${imagePlans.filter(plan => isPng(plan.filePath)).length} PNG` : "",
        imagePlans.filter(plan => isJpg(plan.filePath)).length ? `${imagePlans.filter(plan => isJpg(plan.filePath)).length} JPG` : "",
        imagePlans.filter(plan => isGif(plan.filePath)).length ? `${imagePlans.filter(plan => isGif(plan.filePath)).length} GIF` : "",
        videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt === "mp4").length ? `${videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt === "mp4").length} MP4` : "",
        videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt === "webm").length ? `${videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt === "webm").length} WEBM` : "",
        videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt === "gif").length ? `${videoPlans.filter(plan => plan.action !== "delete" && plan.targetExt === "gif").length} GIF` : ""
    ].filter(Boolean).join(" + ");

    emit({ type: "status", message: `Optimizing ${fmtSummary || "0 files"}...` });

    for (const plan of toConvert) {
        const mediaPath = plan.filePath;
        const rel = relativePath(workDir, mediaPath);
        try {
            const originalSize = (await stat(mediaPath)).size;
            const fileExt = extname(mediaPath).toLowerCase();
            const existingWebpAlias = aliasToExistingWebp.get(mediaPath);

            if (existingWebpAlias) {
                const relWebp = relativePath(workDir, existingWebpAlias);
                exactRewrites.set(normalizeRef(rel), relWebp);
                await safeUnlink(mediaPath);
                savedBytes += originalSize;
                report.push({
                    type: "deleted",
                    file: rel,
                    srcFormat: fileExt.slice(1).toUpperCase(),
                    originalSize,
                    message: `Заменено существующим WEBP: ${relWebp}`
                });
                done++;
                emit({ type: "progress", done, total, percent: total ? Math.round((done / total) * 100) : 100, file: rel });
                continue;
            }

            if (plan.kind === "video" && VIDEO_EXTS.has(fileExt)) {
                const optimizedTemp = await optimizeVideo(mediaPath, plan.targetExt);
                const newSize = (await stat(optimizedTemp)).size;
                const finalOut = plannedTargets.get(mediaPath) ?? mediaPath;
                const formatChanged = finalOut !== mediaPath;
                const allowLargerResult = plan.explicit && formatChanged;

                if (newSize >= originalSize && !allowLargerResult) {
                    await safeUnlink(optimizedTemp);
                    report.push({
                        type: "error",
                        file: rel,
                        message: `Пропущено: результат больше исходного (${originalSize} -> ${newSize} байт)`
                    });
                    done++;
                    emit({ type: "progress", done, total, percent: total ? Math.round((done / total) * 100) : 100, file: rel });
                    continue;
                }

                await safeUnlink(mediaPath);
                await rename(optimizedTemp, finalOut);

                const saved = originalSize - newSize;
                savedBytes += saved;
                if (finalOut !== mediaPath) {
                    exactRewrites.set(normalizeRef(rel), relativePath(workDir, finalOut));
                }

                report.push({
                    type: "converted",
                    file: rel,
                    srcFormat: plan.targetExt.toUpperCase(),
                    originalSize,
                    newSize,
                    saved,
                    savedPercent: Math.round((saved / originalSize) * 100)
                });
                done++;
                emit({ type: "progress", done, total, percent: total ? Math.round((done / total) * 100) : 100, file: rel });
                continue;
            }

            const out = plannedTargets.get(mediaPath) ?? toWebpPath(mediaPath);
            const inputBuffer = await readFile(mediaPath);
            await sharp(inputBuffer, { animated: isGif(mediaPath) }).webp({ quality: 82, effort: 4 }).toFile(out);
            const newSize = (await stat(out)).size;

            if (newSize >= originalSize) {
                await safeUnlink(out);
                report.push({
                    type: "error",
                    file: rel,
                    message: `Пропущено: результат больше исходного (${originalSize} -> ${newSize} байт)`
                });
                done++;
                emit({ type: "progress", done, total, percent: total ? Math.round((done / total) * 100) : 100, file: rel });
                continue;
            }

            const saved = originalSize - newSize;
            savedBytes += saved;
            await safeUnlink(mediaPath);
            const relWebp = relativePath(workDir, out);
            exactRewrites.set(normalizeRef(rel), relWebp);
            report.push({
                type: "converted",
                file: rel,
                srcFormat: isPng(mediaPath) ? "PNG" : isGif(mediaPath) ? "GIF" : "JPG",
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

    for (const plan of toDelete) {
        const rel = relativePath(workDir, plan.filePath);
        try {
            const originalSize = (await stat(plan.filePath)).size;
            await safeUnlink(plan.filePath);
            savedBytes += originalSize;
            report.push({
                type: "deleted",
                file: rel,
                srcFormat: extname(plan.filePath).slice(1).toUpperCase(),
                originalSize,
                message: "Удалено по выбору пользователя"
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
        const currentImages = currentFiles.filter(filePath => MEDIA_EXTS.has(extname(filePath).toLowerCase()));
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
    let replacedFiles = 0;
    const finalReferencedAssets = new Set();
    const finalUnresolvedAssetNames = new Set();
    for (const codeFile of codeFiles) {
        const content = await readFile(codeFile, "utf8").catch(() => null);
        if (!content) continue;
        const skippedRefs = new Map();
        let updated = replaceImageRefs(content, codeFile, workDir, exactRewrites, (rawPath, reason) => {
            if (!rawPath) return;
            skippedRefs.set(`${reason}: ${rawPath}`, { rawPath, reason });
        });
        updated = stripResponsiveAttrs(updated);
        const { exactRefs, unresolvedNames } = collectReferencedAssets(updated, codeFile, workDir, (rawPath, reason) => {
            if (!rawPath) return;
            skippedRefs.set(`${reason}: ${rawPath}`, { rawPath, reason });
        });
        for (const ref of exactRefs) finalReferencedAssets.add(ref);
        for (const name of unresolvedNames) finalUnresolvedAssetNames.add(name);
        if (updated !== content) {
            await writeFile(codeFile, updated, "utf8");
            replacedFiles++;
        }
        if (skippedRefs.size > 0) {
            const relCodeFile = relative(workDir, codeFile).replace(/\\/g, "/");
            for (const { rawPath, reason } of skippedRefs.values()) {
                report.push({
                    type: "error",
                    file: relCodeFile,
                    message: `${reason}: ${rawPath}`
                });
            }
        }
    }

    if (removeUnused) {
        emit({ type: "status", message: "Removing unused assets..." });
        const currentFiles = await walkDir(workDir);
        const currentAssets = currentFiles.filter(filePath => REMOVABLE_ASSET_EXTS.has(extname(filePath).toLowerCase()));

        for (const assetPath of currentAssets) {
            if (isReferencedAsset(assetPath, workDir, finalReferencedAssets, finalUnresolvedAssetNames)) {
                continue;
            }

            const rel = relative(workDir, assetPath).replace(/\\/g, "/");
            const originalSize = (await stat(assetPath)).size;
            await safeUnlink(assetPath);
            report.push({
                type: "deleted",
                file: rel,
                srcFormat: extname(assetPath).slice(1).toUpperCase(),
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
