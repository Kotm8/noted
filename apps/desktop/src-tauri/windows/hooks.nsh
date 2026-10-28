; Updates run the uninstaller with /UPDATE first, so the startup entry is only
; removed when Noted is really uninstalled.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Noted"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Noted"
  ${EndIf}
!macroend
