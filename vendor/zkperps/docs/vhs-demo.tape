# Charm VHS tape — optional GIF/MP4 export (install: https://github.com/charmbracelet/vhs)
# vhs docs/vhs-demo.tape
# Needs a local scripts/cli-demo-replay.ts (gitignored). Otherwise screen-record docs/demo-terminal.html.
Output demo/zkperps-pipeline-replay.gif
Set FontSize 16
Set Width 1280
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

Hide
Type "cd Anti-Front-Running-ZKPerps-on-Cardano-w-MidnightZK && DEMO_QUICK=1 npx tsx scripts/cli-demo-replay.ts" Enter
Sleep 500ms
Show

Sleep 2s

# Let the replay finish (~60–90s at DEMO_QUICK=1); extend Sleep if needed.
Sleep 75s

Sleep 1s
