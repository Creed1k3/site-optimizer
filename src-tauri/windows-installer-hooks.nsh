Var AddContextMenu

!macro NSIS_HOOK_PREINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Добавить пункт 'Оптимизировать размер сайта' в контекстное меню ZIP-архивов и папок?" IDYES add_context_menu IDNO skip_context_menu
  add_context_menu:
    StrCpy $AddContextMenu "1"
    Goto done_context_menu
  skip_context_menu:
    StrCpy $AddContextMenu "0"
  done_context_menu:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCmp $AddContextMenu "1" 0 no_context_menu
    WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.zip\shell\SiteOptimizer" "" "Оптимизировать размер сайта"
    WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.zip\shell\SiteOptimizer" "Icon" "$INSTDIR\site-optimizer.exe"
    WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.zip\shell\SiteOptimizer\command" "" '"$INSTDIR\site-optimizer.exe" "%1"'

    WriteRegStr HKCU "Software\Classes\Directory\shell\SiteOptimizer" "" "Оптимизировать размер сайта"
    WriteRegStr HKCU "Software\Classes\Directory\shell\SiteOptimizer" "Icon" "$INSTDIR\site-optimizer.exe"
    WriteRegStr HKCU "Software\Classes\Directory\shell\SiteOptimizer\command" "" '"$INSTDIR\site-optimizer.exe" "%1"'
  no_context_menu:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.zip\shell\SiteOptimizer"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SiteOptimizer"
!macroend
