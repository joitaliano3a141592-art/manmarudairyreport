param(
  [Parameter(Mandatory = $true)]
  [string]$SiteUrl,

  [switch]$SeedDemoData
)

$ErrorActionPreference = "Stop"

function Ensure-List {
  param(
    [string]$Title,
    [string]$Template = "GenericList"
  )

  $existing = Get-PnPList -Identity $Title -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    Write-Host "[CREATE] List: $Title"
    New-PnPList -Title $Title -Template $Template -OnQuickLaunch | Out-Null
    return Get-PnPList -Identity $Title
  }

  Write-Host "[SKIP] List exists: $Title"
  return $existing
}

function Ensure-Field {
  param(
    [string]$ListTitle,
    [string]$InternalName,
    [string]$DisplayName,
    [string]$Type,
    [bool]$Required = $false
  )

  $field = Get-PnPField -List $ListTitle -Identity $InternalName -ErrorAction SilentlyContinue
  if ($null -ne $field) {
    Write-Host "[SKIP] Field exists: $ListTitle.$InternalName"
    return
  }

  Write-Host "[CREATE] Field: $ListTitle.$InternalName ($Type)"
  Add-PnPField -List $ListTitle -DisplayName $DisplayName -InternalName $InternalName -Type $Type -Required:$Required -AddToDefaultView:$false | Out-Null
}

function Ensure-ChoiceField {
  param(
    [string]$ListTitle,
    [string]$InternalName,
    [string]$DisplayName,
    [string[]]$Choices,
    [bool]$Required = $false
  )

  $field = Get-PnPField -List $ListTitle -Identity $InternalName -ErrorAction SilentlyContinue
  if ($null -ne $field) {
    Write-Host "[SKIP] Field exists: $ListTitle.$InternalName"
    return
  }

  $requiredXml = if ($Required) { "TRUE" } else { "FALSE" }
  $choicesXml = ($Choices | ForEach-Object { "<CHOICE>$_</CHOICE>" }) -join ""
  $fieldXml = "<Field Type='Choice' Name='$InternalName' DisplayName='$DisplayName' Required='$requiredXml' Format='Dropdown'><CHOICES>$choicesXml</CHOICES></Field>"

  Write-Host "[CREATE] Field: $ListTitle.$InternalName (Choice)"
  Add-PnPFieldFromXml -List $ListTitle -FieldXml $fieldXml | Out-Null
}

function Ensure-LookupField {
  param(
    [string]$ListTitle,
    [string]$InternalName,
    [string]$DisplayName,
    [object]$LookupList,
    [string]$ShowField = "Title",
    [bool]$Required = $false
  )

  $field = Get-PnPField -List $ListTitle -Identity $InternalName -ErrorAction SilentlyContinue
  if ($null -ne $field) {
    Write-Host "[SKIP] Field exists: $ListTitle.$InternalName"
    return
  }

  $requiredXml = if ($Required) { "TRUE" } else { "FALSE" }
  $listGuid = "{$($LookupList.Id)}"
  $fieldXml = "<Field Type='Lookup' Name='$InternalName' DisplayName='$DisplayName' Required='$requiredXml' List='$listGuid' ShowField='$ShowField' />"

  Write-Host "[CREATE] Field: $ListTitle.$InternalName (Lookup -> $($LookupList.Title))"
  Add-PnPFieldFromXml -List $ListTitle -FieldXml $fieldXml | Out-Null
}

function Get-ItemMapByTitle {
  param([string]$ListTitle)

  $items = Get-PnPListItem -List $ListTitle -PageSize 500
  $map = @{}
  foreach ($item in $items) {
    $title = [string]$item["Title"]
    if (-not [string]::IsNullOrWhiteSpace($title)) {
      $map[$title] = [int]$item["ID"]
    }
  }
  return $map
}

Write-Host "[STEP] Connect to SharePoint site"
Connect-PnPOnline -Url $SiteUrl -Interactive

Write-Host "[STEP] Ensure lists"
$customers = Ensure-List -Title "顧客マスタ"
$systems = Ensure-List -Title "システムマスタ"
$workTypes = Ensure-List -Title "作業種別マスタ"
$workReports = Ensure-List -Title "作業報告"
$workPlans = Ensure-List -Title "作業予定"

Write-Host "[STEP] Ensure columns: 顧客マスタ"
# Title = 会社名

Write-Host "[STEP] Ensure columns: システムマスタ"
Ensure-LookupField -ListTitle "システムマスタ" -InternalName "Customer" -DisplayName "顧客" -LookupList $customers -Required $true
Ensure-Field -ListTitle "システムマスタ" -InternalName "Description" -DisplayName "説明" -Type "Note"

Write-Host "[STEP] Ensure columns: 作業種別マスタ"
Ensure-ChoiceField -ListTitle "作業種別マスタ" -InternalName "Category" -DisplayName "カテゴリ" -Choices @("開発", "保守", "運用", "会議", "その他")

Write-Host "[STEP] Ensure columns: 作業報告"
Ensure-Field -ListTitle "作業報告" -InternalName "ReportDate" -DisplayName "作業日" -Type "DateTime" -Required $true
Ensure-LookupField -ListTitle "作業報告" -InternalName "Customer" -DisplayName "顧客" -LookupList $customers -Required $true
Ensure-LookupField -ListTitle "作業報告" -InternalName "System" -DisplayName "システム" -LookupList $systems -Required $true
Ensure-LookupField -ListTitle "作業報告" -InternalName "WorkType" -DisplayName "作業種別" -LookupList $workTypes -Required $true
Ensure-Field -ListTitle "作業報告" -InternalName "WorkDescription" -DisplayName "作業内容" -Type "Note" -Required $true
Ensure-Field -ListTitle "作業報告" -InternalName "WorkHours" -DisplayName "作業時間" -Type "Number" -Required $true
Ensure-Field -ListTitle "作業報告" -InternalName "Reporter" -DisplayName "報告者" -Type "User"

Write-Host "[STEP] Ensure columns: 作業予定"
Ensure-Field -ListTitle "作業予定" -InternalName "PlanDate" -DisplayName "予定日" -Type "DateTime" -Required $true
Ensure-LookupField -ListTitle "作業予定" -InternalName "Customer" -DisplayName "顧客" -LookupList $customers -Required $true
Ensure-LookupField -ListTitle "作業予定" -InternalName "System" -DisplayName "システム" -LookupList $systems -Required $true
Ensure-Field -ListTitle "作業予定" -InternalName "WorkDescription" -DisplayName "作業内容" -Type "Note" -Required $true
Ensure-Field -ListTitle "作業予定" -InternalName "Assignee" -DisplayName "担当者" -Type "User"
Ensure-ChoiceField -ListTitle "作業予定" -InternalName "Status" -DisplayName "状態" -Choices @("未着手", "進行中", "完了") -Required $true

if ($SeedDemoData) {
  Write-Host "[STEP] Seed demo data"

  if ((Get-PnPListItem -List "顧客マスタ" -PageSize 1).Count -eq 0) {
    Add-PnPListItem -List "顧客マスタ" -Values @{ Title = "ABC 株式会社" } | Out-Null
    Add-PnPListItem -List "顧客マスタ" -Values @{ Title = "XYZ 工業" } | Out-Null
    Add-PnPListItem -List "顧客マスタ" -Values @{ Title = "テックス合同会社" } | Out-Null
  }

  $customerMap = Get-ItemMapByTitle -ListTitle "顧客マスタ"

  if ((Get-PnPListItem -List "システムマスタ" -PageSize 1).Count -eq 0) {
    Add-PnPListItem -List "システムマスタ" -Values @{ Title = "システムA"; Customer = $customerMap["ABC 株式会社"]; Description = "基幹システム" } | Out-Null
    Add-PnPListItem -List "システムマスタ" -Values @{ Title = "システムB"; Customer = $customerMap["ABC 株式会社"]; Description = "周辺システム" } | Out-Null
    Add-PnPListItem -List "システムマスタ" -Values @{ Title = "システムC"; Customer = $customerMap["XYZ 工業"]; Description = "製造管理" } | Out-Null
    Add-PnPListItem -List "システムマスタ" -Values @{ Title = "システムD"; Customer = $customerMap["テックス合同会社"]; Description = "販売管理" } | Out-Null
  }

  if ((Get-PnPListItem -List "作業種別マスタ" -PageSize 1).Count -eq 0) {
    Add-PnPListItem -List "作業種別マスタ" -Values @{ Title = "機能開発"; Category = "開発" } | Out-Null
    Add-PnPListItem -List "作業種別マスタ" -Values @{ Title = "テスト"; Category = "保守" } | Out-Null
    Add-PnPListItem -List "作業種別マスタ" -Values @{ Title = "定例会議"; Category = "会議" } | Out-Null
  }

  $systemMap = Get-ItemMapByTitle -ListTitle "システムマスタ"
  $workTypeMap = Get-ItemMapByTitle -ListTitle "作業種別マスタ"

  $today = Get-Date
  $tomorrowDate = $today.AddDays(1)

  if ((Get-PnPListItem -List "作業予定" -PageSize 1).Count -eq 0) {
    Add-PnPListItem -List "作業予定" -Values @{
      Title = "明日-要件確認"
      PlanDate = $tomorrowDate
      Customer = $customerMap["テックス合同会社"]
      System = $systemMap["システムD"]
      WorkDescription = "要件確認と調整"
      Status = "未着手"
    } | Out-Null

    Add-PnPListItem -List "作業予定" -Values @{
      Title = "明日-障害調査"
      PlanDate = $tomorrowDate
      Customer = $customerMap["ABC 株式会社"]
      System = $systemMap["システムB"]
      WorkDescription = "障害対応の予備調査"
      Status = "進行中"
    } | Out-Null

    Add-PnPListItem -List "作業予定" -Values @{
      Title = "今日-定例資料"
      PlanDate = $today
      Customer = $customerMap["ABC 株式会社"]
      System = $systemMap["システムA"]
      WorkDescription = "定例ミーティング資料の整理と共有"
      Status = "完了"
    } | Out-Null
  }

  if ((Get-PnPListItem -List "作業報告" -PageSize 1).Count -eq 0) {
    Add-PnPListItem -List "作業報告" -Values @{
      Title = "日報-機能開発"
      ReportDate = $today
      Customer = $customerMap["ABC 株式会社"]
      System = $systemMap["システムA"]
      WorkType = $workTypeMap["機能開発"]
      WorkDescription = "機能開発（続き）"
      WorkHours = 4.5
    } | Out-Null

    Add-PnPListItem -List "作業報告" -Values @{
      Title = "日報-テスト"
      ReportDate = $today
      Customer = $customerMap["XYZ 工業"]
      System = $systemMap["システムC"]
      WorkType = $workTypeMap["テスト"]
      WorkDescription = "テスト実施"
      WorkHours = 3.0
    } | Out-Null
  }
}

Write-Host ""
Write-Host "Complete."
Write-Host "Next: Power Apps で SharePoint コネクタを追加し、各リストへ接続してください。"