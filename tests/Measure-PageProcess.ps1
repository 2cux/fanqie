param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [ValidateRange(2, 3600)][int]$DurationSeconds = 180,
    [ValidateRange(1, 60)][int]$IntervalSeconds = 5,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'performance-results')
)
$ErrorActionPreference = 'Stop'
$target = Get-Process -Id $TargetProcessId
$processStarted = $target.StartTime
$processName = $target.ProcessName
$logicalProcessors = [Environment]::ProcessorCount
$clock = [Diagnostics.Stopwatch]::StartNew()
$rows = [Collections.Generic.List[object]]::new()
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$csvPath = Join-Path $OutputDirectory "$stamp-$TargetProcessId.csv"
$jsonPath = Join-Path $OutputDirectory "$stamp-$TargetProcessId-summary.json"

function Read-Sample {
    $current = Get-Process -Id $TargetProcessId -ErrorAction Stop
    if ($current.StartTime -ne $processStarted) { throw 'Process ID was reused; stop sampling.' }
    [pscustomobject]@{
        Timestamp = (Get-Date).ToString('o')
        ElapsedSeconds = $clock.Elapsed.TotalSeconds
        CpuSeconds = $current.TotalProcessorTime.TotalSeconds
        WorkingSetMiB = $current.WorkingSet64 / 1MB
        PrivateMemoryMiB = $current.PrivateMemorySize64 / 1MB
        Handles = $current.HandleCount
        Threads = $current.Threads.Count
    }
}

$first = Read-Sample
$previous = $first
$rows.Add($first)
$status = 'completed'
$failure = $null
$lastProgress = 0
try {
    while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $remaining = $DurationSeconds - $clock.Elapsed.TotalSeconds
        $sleepMs = [math]::Ceiling([math]::Min([double]$IntervalSeconds, [double]$remaining) * 1000)
        Start-Sleep -Milliseconds ([int][math]::Max(1, $sleepMs))
        $sample = Read-Sample
        $delta = $sample.ElapsedSeconds - $previous.ElapsedSeconds
        $cpu = 100 * ($sample.CpuSeconds - $previous.CpuSeconds) / $delta
        $sample | Add-Member NoteProperty CpuPercentOneCore $cpu
        $sample | Add-Member NoteProperty CpuPercentMachine ($cpu / $logicalProcessors)
        $rows.Add($sample)
        $previous = $sample
        if ($sample.ElapsedSeconds - $lastProgress -ge 30) {
            Write-Output ('{0:N0}s CPU(one core)={1:N3}% WorkingSet={2:N2}MiB Private={3:N2}MiB' -f $sample.ElapsedSeconds, $cpu, $sample.WorkingSetMiB, $sample.PrivateMemoryMiB)
            $lastProgress = $sample.ElapsedSeconds
        }
    }
} catch {
    $status = 'interrupted'
    $failure = $_.Exception.Message
}
$last = $rows[$rows.Count - 1]
$seconds = $last.ElapsedSeconds - $first.ElapsedSeconds
$cpuDelta = $last.CpuSeconds - $first.CpuSeconds
$meanCpu = if ($seconds -gt 0) { 100 * $cpuDelta / $seconds } else { 0 }
$rows | Select-Object Timestamp,ElapsedSeconds,CpuSeconds,CpuPercentOneCore,CpuPercentMachine,WorkingSetMiB,PrivateMemoryMiB,Handles,Threads |
    Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding utf8
$summary = [ordered]@{
    Status = $status; Failure = $failure
    ProcessId = $TargetProcessId; ProcessName = $processName; ProcessStarted = $processStarted.ToString('o')
    LogicalProcessors = $logicalProcessors; SampleCount = $rows.Count; DurationSeconds = $seconds
    CpuSecondsConsumed = $cpuDelta; MeanCpuPercentOneCore = $meanCpu; MeanCpuPercentMachine = $meanCpu / $logicalProcessors
    PeakIntervalCpuPercentOneCore = ($rows | Measure-Object CpuPercentOneCore -Maximum).Maximum
    WorkingSetStartMiB = $first.WorkingSetMiB; WorkingSetEndMiB = $last.WorkingSetMiB
    WorkingSetPeakMiB = ($rows | Measure-Object WorkingSetMiB -Maximum).Maximum
    PrivateStartMiB = $first.PrivateMemoryMiB; PrivateEndMiB = $last.PrivateMemoryMiB
    PrivatePeakMiB = ($rows | Measure-Object PrivateMemoryMiB -Maximum).Maximum
    HandlesStart = $first.Handles; HandlesEnd = $last.Handles; ThreadsStart = $first.Threads; ThreadsEnd = $last.Threads
    CsvPath = $csvPath
    Notes = 'Read-only OS counters. CPU one-core 100% means one logical core fully occupied. Private bytes are committed memory, not JS heap. Shared renderer/GPU work cannot be attributed to a single page. Visibility is controlled by the user, not inferred by this script.'
}
$summary | ConvertTo-Json | Set-Content -LiteralPath $jsonPath -Encoding utf8
$summary | ConvertTo-Json
if ($status -ne 'completed') { exit 1 }
