Var AddContextMenuNormal
Var AddContextMenuQuick

!macro NSIS_HOOK_PREINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Добавить пункт 'Оптимизировать сайт' в контекстное меню ZIP-архивов и папок?" IDYES add_context_menu_normal IDNO skip_context_menu_normal
  add_context_menu_normal:
    StrCpy $AddContextMenuNormal "1"
    Goto ask_quick_context_menu
  skip_context_menu_normal:
    StrCpy $AddContextMenuNormal "0"

  ask_quick_context_menu:
  MessageBox MB_YESNO|MB_ICONQUESTION "Добавить пункт 'Быстро оптимизировать сайт' в контекстное меню ZIP-архивов и папок?" IDYES add_context_menu_quick IDNO skip_context_menu_quick
  add_context_menu_quick:
    StrCpy $AddContextMenuQuick "1"
    Goto done_context_menu
  skip_context_menu_quick:
    StrCpy $AddContextMenuQuick "0"
  done_context_menu:
!macroend

!macro RegisterVerb ROOT_KEY SUBKEY TITLE COMMAND
  WriteRegStr HKCU "${ROOT_KEY}\${SUBKEY}" "" "${TITLE}"
  WriteRegStr HKCU "${ROOT_KEY}\${SUBKEY}" "Icon" "$INSTDIR\site-optimizer.exe"
  WriteRegStr HKCU "${ROOT_KEY}\${SUBKEY}" "MultiSelectModel" "Player"
  WriteRegStr HKCU "${ROOT_KEY}\${SUBKEY}\command" "" '${COMMAND}'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCmp $AddContextMenuNormal "1" 0 no_context_menu_normal
    !insertmacro RegisterVerb "Software\Classes\SystemFileAssociations\.zip\shell" "SiteOptimizer" "Оптимизировать сайт" '"$INSTDIR\site-optimizer.exe" "%1"'
    !insertmacro RegisterVerb "Software\Classes\Directory\shell" "SiteOptimizer" "Оптимизировать сайт" '"$INSTDIR\site-optimizer.exe" "%1"'
  no_context_menu_normal:

  StrCmp $AddContextMenuQuick "1" 0 no_context_menu_quick
    !insertmacro RegisterVerb "Software\Classes\SystemFileAssociations\.zip\shell" "SiteOptimizerQuick" "Быстро оптимизировать сайт" '"$INSTDIR\site-optimizer.exe" --quick "%1"'
    !insertmacro RegisterVerb "Software\Classes\Directory\shell" "SiteOptimizerQuick" "Быстро оптимизировать сайт" '"$INSTDIR\site-optimizer.exe" --quick "%1"'
  no_context_menu_quick:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.zip\shell\SiteOptimizer"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SiteOptimizer"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.zip\shell\SiteOptimizerQuick"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SiteOptimizerQuick"
!macroend
