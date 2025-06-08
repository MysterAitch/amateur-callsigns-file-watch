Write-Host "Processing amateur callsigns CSV file..."

# Check if the CSV file exists
if (-not (Test-Path "amateur-callsigns.csv")) {
    Write-Error "amateur-callsigns.csv file not found! Please run scrape-and-download-url.ps1 first."
    exit 1
}

# Check for download metadata (contains URL and Ofcom last updated date)
$downloadMetadata = $null
if (Test-Path "download-metadata.json") {
    $downloadMetadata = Get-Content "download-metadata.json" | ConvertFrom-Json
    Write-Host "Found download metadata. URL: $($downloadMetadata.url)"
    Write-Host "Ofcom-reported last updated date: $($downloadMetadata.lastUpdated)"
} else {
    Write-Warning "download-metadata.json not found. Some metadata will be missing."
}

# Check if file is empty
$file = Get-Item "amateur-callsigns.csv"
if ($file.Length -eq 0) {
    Write-Error "Error: The CSV file is empty!"
    exit 1
}

# Calculate hash of the original CSV file
$originalCsvHash = (Get-FileHash -Path "amateur-callsigns.csv" -Algorithm SHA256).Hash
Write-Host "Original CSV file size: $($file.Length) bytes. Hash: $originalCsvHash"

# Check if we need to process the file by comparing with existing metadata
$needsProcessing = $true
if (Test-Path "amateur-callsigns-metadata.json") {
    try {
        $existingMetadata = Get-Content "amateur-callsigns-metadata.json" | ConvertFrom-Json
        if (($existingMetadata.originalCsvHash -eq $originalCsvHash) -and
            (Test-Path "amateur-callsigns-sorted.csv") -and
            (Test-Path "amateur-callsigns.json") -and
            (Test-Path "amateur-callsigns-sorted.json")) {
                Write-Host "All files already exist and CSV hash matches. No processing needed."
                $needsProcessing = $false
        }
    } catch {
        Write-Host "Error comparing with existing metadata. Will process file: $_"
    }
}

if ($needsProcessing) {
    try {
        # Create a sorted version of the CSV file
        Write-Host "Creating sorted version of the CSV file..."
        $csvData = Import-Csv -Path "amateur-callsigns.csv"

        # Sort by the first column (assuming it contains callsigns)
        # Get the first property name (column header) dynamically
        $firstColumnName = $csvData[0].PSObject.Properties.Name[0]
        Write-Host "Sorting by column: $firstColumnName"

        # Sort and export to a new file
        $csvData | Sort-Object -Property $firstColumnName | Export-Csv -Path "amateur-callsigns-sorted.csv" -NoTypeInformation
        Write-Host "Successfully created sorted CSV file"

        # Create JSON versions of the data
        Write-Host "Creating JSON versions of the data..."
        $csvData | ConvertTo-Json | Set-Content -Path "amateur-callsigns.json"
        $csvData | Sort-Object -Property $firstColumnName | ConvertTo-Json | Set-Content -Path "amateur-callsigns-sorted.json"
        Write-Host "Successfully created JSON files"

        # Calculate hashes for all files
        $sortedCsvHash = (Get-FileHash -Path "amateur-callsigns-sorted.csv" -Algorithm SHA256).Hash
        $originalJsonHash = (Get-FileHash -Path "amateur-callsigns.json" -Algorithm SHA256).Hash
        $sortedJsonHash = (Get-FileHash -Path "amateur-callsigns-sorted.json" -Algorithm SHA256).Hash

        # Get file sizes
        $sortedCsvFile = Get-Item "amateur-callsigns-sorted.csv"
        $originalJsonFile = Get-Item "amateur-callsigns.json"
        $sortedJsonFile = Get-Item "amateur-callsigns-sorted.json"

        Write-Host "Sorted CSV checksum: $sortedCsvHash"
        Write-Host "Original JSON checksum: $originalJsonHash"
        Write-Host "Sorted JSON checksum: $sortedJsonHash"

        # Create comprehensive metadata
        $metadata = @{
            originalCsvSize = $file.Length
            originalCsvHash = $originalCsvHash
            sortedCsvSize = $sortedCsvFile.Length
            sortedCsvHash = $sortedCsvHash
            originalJsonSize = $originalJsonFile.Length
            originalJsonHash = $originalJsonHash
            sortedJsonSize = $sortedJsonFile.Length
            sortedJsonHash = $sortedJsonHash
            processDate = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        }

        # Add download metadata if available
        if ($downloadMetadata) {
            $metadata.Add("url", $downloadMetadata.url)
            $metadata.Add("lastUpdated", $downloadMetadata.lastUpdated)
            $metadata.Add("scrapeDate", $downloadMetadata.scrapeDate)
        }

        # Save metadata
        $metadata | ConvertTo-Json | Set-Content -Path "amateur-callsigns-metadata.json"
        Write-Host "Saved comprehensive metadata to amateur-callsigns-metadata.json"

    } catch {
        Write-Error "Failed to process CSV file: $_"
        exit 1
    }
} else {
    Write-Host "No changes detected. Using existing files."
}

Write-Host "CSV processing complete!"
Write-Host "Files available:"
Get-ChildItem -Path . -File | Where-Object {$_.Name -match "amateur-callsigns|download-metadata"} | Format-Table -AutoSize
