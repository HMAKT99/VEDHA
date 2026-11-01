# Records examples/guard-demo/demo.gif with VHS (https://github.com/charmbracelet/vhs):
#   pnpm build && vhs examples/guard-demo/demo.tape
Output examples/guard-demo/demo.gif
Set FontSize 17
Set Width 1400
Set Height 530
Set Padding 24
Set TypingSpeed 35ms

Hide
Type "clear" Enter
Show
Type "head -n1 examples/guard-demo/*.spec.ts" Sleep 300ms Enter
Sleep 2.5s
Type "npx tsx examples/guard-demo/run.ts" Sleep 300ms Enter
Sleep 9s
