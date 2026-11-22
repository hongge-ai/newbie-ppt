# Render a private, read-only copy. Leave other open presentations untouched.
$ErrorActionPreference = 'Stop'
try {
    $ppt = New-Object -ComObject PowerPoint.Application
    $oldSecurity = $ppt.AutomationSecurity
    $ppt.AutomationSecurity = 3
    $deck = $ppt.Presentations.Open($env:PPT_PREVIEW_DECK, -1, 0, 0)
    $width = [double]$deck.PageSetup.SlideWidth
    $height = [double]$deck.PageSetup.SlideHeight
    $scale = 1600 / [Math]::Max($width, $height)
    for ($i = 1; $i -le $deck.Slides.Count; $i++) {
        $slide = $deck.Slides.Item($i)
        try {
            $slide.Export((Join-Path $env:PPT_PREVIEW_DIR "$i.png"), 'PNG',
                [int]($width * $scale), [int]($height * $scale))
        } finally {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide)
        }
    }
} finally {
    if ($deck) { $deck.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
    if ($ppt) {
        if ($null -ne $oldSecurity) { $ppt.AutomationSecurity = $oldSecurity }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ppt)
    }
}
