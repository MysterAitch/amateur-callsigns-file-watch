Write-Host "Scraping Ofcom website for the latest amateur radio callsigns CSV URL..."
$response = Invoke-WebRequest -Uri "https://www.ofcom.org.uk/about-ofcom/our-research/opendata"

# Save HTML for debugging if needed
$response.Content | Out-File -FilePath "ofcom_page.html"
Write-Host "Saved HTML content to ofcom_page.html for debugging"

# Use PowerShell's built-in HTML parsing instead of regex
Write-Host "Parsing HTML content..."
$htmlObj = New-Object -Com "HTMLFile"

# Add the content to the HTML parser
try {
    # Method for PowerShell 7+
    $htmlObj.write([System.Text.Encoding]::Unicode.GetBytes($response.Content))
}
catch {
    try {
        # Method for older PowerShell versions
        $htmlObj.IHTMLDocument2_write($response.Content)
    }
    catch {
        # Fallback method
        [void]$htmlObj.IHTMLDocument2_write($response.Content)
    }
}

# Find all <a> tags (links) in the document
Write-Host "Searching for CSV links related to amateur radio..."
$links = @($htmlObj.getElementsByTagName("a"))
$amateurCsvLinks = @()

# Filter for links containing "amateur" and ".csv" in the href attribute
foreach ($link in $links) {
    $href = $link.getAttribute("href")
    if ($href -and ($href -match "amateur" -and $href -match "\.csv")) {
        # Remove the 'about:' prefix that the COM object adds to relative URLs
        $cleanHref = $href -replace "^about:", ""
        Write-Host "Found potential amateur CSV link: $href (cleaned: $cleanHref) with text: $($link.innerText)"
        $amateurCsvLinks += [PSCustomObject]@{
            Href = $cleanHref  # Store the cleaned version
            Text = $link.innerText
            Element = $link
        }
    }
}

if ($amateurCsvLinks.Count -gt 0) {
    Write-Host "Found $($amateurCsvLinks.Count) potential amateur radio CSV links."

    # Select the most likely one - preferably containing "callsign"
    $bestMatch = $null
    foreach ($link in $amateurCsvLinks) {
        if ($link.Href -match "callsign" -or $link.Text -match "callsign") {
            $bestMatch = $link
            Write-Host "Selected best match with callsign in URL or text"
            break
        }

        # If we haven't found a better match yet, use this one
        if ($null -eq $bestMatch) {
            $bestMatch = $link
        }
    }

    if ($null -ne $bestMatch) {
        $relativeUrl = $bestMatch.Href

        # Find the parent table row to extract the date
        $element = $bestMatch.Element
        $updatedDate = $null

        # Navigate up to find the table row
        while ($element -and $element.tagName -ne "TR") {
            $element = $element.parentElement
        }

        # If we found the row, look for the date cell (typically the next TD after the one containing the link)
        if ($element -and $element.tagName -eq "TR") {
            $cells = @($element.getElementsByTagName("td"))
            if ($cells.Count -gt 1) {
                # Usually the date is in the second column
                $updatedDate = $cells[1].innerText.Trim()
            }
        }

        # Fallback if we couldn't find the date
        if (-not $updatedDate) {
            $updatedDate = (Get-Date -Format "d MMMM yyyy")
            Write-Host "Couldn't find update date in the page - using today's date as fallback"
        } else {
            Write-Host "Found date from table: $updatedDate"
        }

        # Prepare the URL
        $baseUrl = "https://www.ofcom.org.uk"
        # If URL already starts with http, don't prepend the base URL
        if ($relativeUrl -match "^https?://") {
            $fullUrl = $relativeUrl
        } else {
            # If URL doesn't start with /, add it
            if (-not $relativeUrl.StartsWith("/")) {
                $relativeUrl = "/$relativeUrl"
            }
            $fullUrl = "$baseUrl$relativeUrl"
        }

        Write-Host "Found CSV URL: $fullUrl"
        Write-Host "Ofcom-reported last updated date: $updatedDate"

        # Create a simple metadata file with URL and date
        $downloadMetadata = @{
            url = $fullUrl
            ofcomLastUpdate = $updatedDate
            linkText = $bestMatch.Text
        } | ConvertTo-Json

        Set-Content -Path "download-metadata.json" -Value $downloadMetadata
        Write-Host "Saved download metadata to download-metadata.json"

        # Check if previous CSV exists and compare URLs
        $shouldDownload = $true
        if ((Test-Path "amateur-callsigns.csv") -and (Test-Path "download-metadata.json")) {
            try {
                $existingMetadata = Get-Content "download-metadata.json" | ConvertFrom-Json
                if ($existingMetadata.url -eq $fullUrl) {
                    # Same URL, check if file has changed by downloading to temp file and comparing
                    Write-Host "URL hasn't changed. Downloading to temp file to check for content changes..."
                    $tempCsvPath = "temp-amateur-callsigns.csv"

                    Write-Host "Start downloading CSV file to temporary location: $tempCsvPath"
                    Invoke-WebRequest -Uri $fullUrl -OutFile $tempCsvPath
                    Write-Host "End downloading CSV file to temporary location: $tempCsvPath"

                    $newFileHash = (Get-FileHash -Path $tempCsvPath -Algorithm SHA256).Hash
                    $existingFileHash = (Get-FileHash -Path "amateur-callsigns.csv" -Algorithm SHA256).Hash

                    if ($newFileHash -eq $existingFileHash) {
                        Write-Host "File content hasn't changed. No download needed."
                        $shouldDownload = $false
                        Remove-Item -Path $tempCsvPath -Force
                    } else {
                        Write-Host "File content has changed. Will use downloaded temp file."
                        Move-Item -Path $tempCsvPath -Destination "amateur-callsigns.csv" -Force
                        $shouldDownload = $false # Already downloaded to temp file
                    }
                }
            }
            catch {
                Write-Host "Error comparing existing files. Will download again: $_"
            }
        }

        # Download the file if needed
        if ($shouldDownload) {
            Write-Host "Downloading amateur callsigns CSV file..."
            Invoke-WebRequest -Uri $fullUrl -OutFile "amateur-callsigns.csv"
            Write-Host "Download complete."
        }

        # Check if file was downloaded successfully
        if (Test-Path "amateur-callsigns.csv") {
            $file = Get-Item "amateur-callsigns.csv"
            if ($file.Length -eq 0) {
                Write-Error "Error: The downloaded file is empty!"
                exit 1
            }
            Write-Host "CSV file downloaded successfully. File size: $($file.Length) bytes."
        }
        else {
            Write-Error "Failed to download the CSV file!"
            exit 1
        }
    }
    else {
        Write-Error "Failed to select a suitable amateur radio CSV link."
        exit 1
    }
}
else {
    Write-Error "Failed to find any amateur radio CSV links on the Ofcom website!"
    Write-Host "Please check ofcom_page.html to see the current structure of the page."
    exit 1
}
