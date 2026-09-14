# Renders the raw voice lines for the sample clips with the Windows speech engine.
# Output: %TEMP%\attune-tts\*.wav (24 kHz, 16-bit, mono). make-samples.mjs mixes them.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$out = Join-Path ([IO.Path]::GetTempPath()) 'attune-tts'
New-Item -ItemType Directory -Force $out | Out-Null

$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  24000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono)

$lines = @(
  @{ name = 'david_calm'; voice = 'Microsoft David'; rate = 0
     text = "Let's go through the plan for next quarter. The first milestone is the pilot with the two hospitals in Ghent. We ship the sensors in October and start collecting data the week after. If the early numbers look good, we extend the pilot to the warehouse team in December." },
  @{ name = 'zira_calm'; voice = 'Microsoft Zira'; rate = 0
     text = "I went through the feedback from the last round of testing. Most people found the belt comfortable, but a few said the vibration was too subtle while walking. We could raise the intensity a little, or repeat the pulse after a few seconds." },
  @{ name = 'mark_fast'; voice = 'Microsoft Mark'; rate = 6
     text = "Quick update on the budget. We're still under on hardware, but the tooling line is over because we had to reorder the injection mould, so I'd like to move the difference from the marketing line and revisit it at the end of the month, if that's fine with everyone." },
  @{ name = 'zira_fast'; voice = 'Microsoft Zira'; rate = 6
     text = "And on logistics, the courier changed their pickup window, so anything we want out on Friday has to be packed by eleven, which means the assembly batch needs to start on Wednesday instead of Thursday." },
  @{ name = 'bart_calm'; voice = 'Microsoft Bart'; rate = 0
     text = "Voor de opleiding van de ploegbazen stel ik voor dat we starten met een korte sessie van een half uur. We tonen hoe de sensor werkt, wat de trilling betekent, en waar ze terecht kunnen met vragen." },
  @{ name = 'david_calm2'; voice = 'Microsoft David'; rate = 0
     text = "One more thing on the dashboard. The weekly summary now shows posture time per shift, and managers can compare teams side by side. We should decide whether that view stays internal or goes to customers too." },
  @{ name = 'zira_calm2'; voice = 'Microsoft Zira'; rate = 0
     text = "Then I think we're done for today. I'll send the notes this afternoon, and we meet again next Tuesday to look at the first pilot data." }
)

foreach ($l in $lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $s.SelectVoice($l.voice)
    $s.Rate = $l.rate
    $path = Join-Path $out "$($l.name).wav"
    $s.SetOutputToWaveFile($path, $fmt)
    $s.Speak($l.text)
    $s.SetOutputToNull()
    Write-Host "wrote $path"
  } finally {
    $s.Dispose()
  }
}
