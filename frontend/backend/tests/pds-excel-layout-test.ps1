param([Parameter(Mandatory = $true)][string]$FixtureDirectory)

$ErrorActionPreference = 'Stop'
$excel = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.AutomationSecurity = 3
    $fixtures = @(@{Name = 'main'; Pages = 4}, @{Name = 'continuation'; Pages = 5})
    if (Test-Path -LiteralPath (Join-Path $FixtureDirectory 'pds-2026-sections.xlsx')) {
        $fixtures += @{Name = 'sections'; Pages = 6}
    }
    foreach ($fixture in $fixtures) {
        $book = $null
        try {
            $path = [System.IO.Path]::GetFullPath((Join-Path $FixtureDirectory ('pds-2026-' + $fixture.Name + '.xlsx')))
            $book = $excel.Workbooks.Open($path, 0, $true)
            $visible = 0
            foreach ($sheet in $book.Worksheets) {
                if ($sheet.Visible -eq -1) {
                    $visible++
                    $sheet.Activate()
                    if ($book.Windows.Item(1).View -ne 1 -or $book.Windows.Item(1).Zoom -ne 100 -or $sheet.DisplayPageBreaks) {
                        throw ('The form would open in a fragmented page view: ' + $sheet.Name)
                    }
                    if ($sheet.PageSetup.PaperSize -ne 5 -or $sheet.PageSetup.Zoom -ne $false -or $sheet.PageSetup.FitToPagesWide -ne 1 -or $sheet.PageSetup.FitToPagesTall -ne 1) {
                        throw ('Incorrect native print layout: ' + $sheet.Name)
                    }
                    $formRange = $sheet.Range($sheet.PageSetup.PrintArea)
                    $firstOutsideColumn = $formRange.Column + $formRange.Columns.Count
                    $blankColumn = $firstOutsideColumn
                    while ($sheet.Columns.Item($blankColumn).Hidden -and $blankColumn -lt 16384) {
                        $blankColumn++
                    }
                    if ($sheet.Columns.Item(16384).Hidden -or $sheet.Columns.Item($blankColumn).ColumnWidth -lt 6) {
                        throw ('The blank worksheet canvas would be dark: ' + $sheet.Name)
                    }
                    foreach ($cell in @($sheet.Cells.Item(1, $blankColumn), $sheet.Cells.Item(20, $blankColumn + 2), $sheet.Cells.Item(200, 16384))) {
                        if ($cell.Interior.Color -ne 16777215) {
                            throw ('The blank worksheet canvas is not white: ' + $sheet.Name + '!' + $cell.Address())
                        }
                    }
                    if ($sheet.Name -eq 'C1' -and (-not $sheet.Columns.Item(17).Hidden -or $sheet.Range('Q2').Value2 -eq $null)) {
                        throw 'The country dropdown helper data must remain present and hidden.'
                    }
                }
            }
            if ($visible -ne $fixture.Pages) { throw 'Blank or missing continuation sheets.' }
            $personal = $book.Worksheets.Item(1)
            if ($personal.Range('D10').Value2 -ne 'Test Last' -or $personal.Range('N11').Value2 -ne 'III') {
                throw 'Employee name or suffix was not retained in Excel.'
            }
            foreach ($control in $personal.CheckBoxes()) {
                $caption = $control.Caption.Trim()
                if ($caption -in @('Female', 'Married', 'Filipino') -and $control.Value -ne 1) {
                    throw ('Native checkbox is not selected: ' + $caption)
                }
                if ($caption -in @('Male', 'Single', 'Widowed', 'Separated') -and $control.Value -ne -4146) {
                    throw ('Native checkbox should be unchecked: ' + $caption)
                }
            }
            if ($book.Worksheets.Item(2).Range('J18').Value2 -ne 21877.25 -or $book.Worksheets.Item(2).Range('K18').Value2 -ne '11-2') {
                throw 'Salary or grade/step was not retained in Excel.'
            }
            if ($fixture.Name -eq 'sections') {
                if ($book.Worksheets.Item(2).Range('A11').Value2 -ne 'Civil Eligibility 7' -or
                    $book.Worksheets.Item(9).Range('A28').Value2 -ne 'Civil Eligibility 31' -or
                    [string]$book.Worksheets.Item(9).Range('J28').Text -cne '00031') {
                    throw 'Eligibility main/continuation values were not retained in Excel.'
                }
                if ($book.Worksheets.Item(3).Range('A21').Value2 -ne 'Training Program 17' -or
                    $book.Worksheets.Item(5).Range('A49').Value2 -ne 'Training Program 61' -or
                    $book.Worksheets.Item(3).Range('G5').Value2 -ne 0 -or
                    $book.Worksheets.Item(3).Range('A12').MergeArea.Address() -ne '$A$12:$D$12') {
                    throw 'Training main/continuation values or field widths were not retained in Excel.'
                }
            }
            Write-Output ('Microsoft Excel: ' + $fixture.Name + ' opened continuously at 100% with a white canvas; ' + $visible + ' legal-size form sheets; fields and checkbox states passed.')
        } finally {
            if ($null -ne $book) {
                $book.Close($false)
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book)
            }
        }
    }
} finally {
    if ($null -ne $excel) {
        $excel.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
}
