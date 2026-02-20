Add-Type -AssemblyName System.Drawing
$srcPath = "assets/images/appicon.png"
$img = [System.Drawing.Image]::FromFile((Resolve-Path $srcPath))
$canvasSize = 1024
$logoScale = 0.65
$logoSize = [int]($canvasSize * $logoScale)
$offset = [int](($canvasSize - $logoSize) / 2)
$newImg = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize)
$g = [System.Drawing.Graphics]::FromImage($newImg)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($img, $offset, $offset, $logoSize, $logoSize)
$img.Dispose()
$newImg.Save("assets/images/appicon_resized.png", [System.Drawing.Imaging.ImageFormat]::Png)
$newImg.Dispose()
Move-Item -Path "assets/images/appicon_resized.png" -Destination "assets/images/appicon.png" -Force
