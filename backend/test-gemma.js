const text = '<|tool_call>call:read_slide{indices:[1]}<tool_call|>';
const gemmaPattern = /<\|tool_call>call:([a-zA-Z_][a-zA-Z0-9_]*)\s*(\{[\s\S]*?\})<tool_call\|>/g;
const matches = text.matchAll(gemmaPattern);
for (const match of matches) {
    console.log('function:', match[1]);
    let argsStr = match[2];
    console.log('argsStr:', argsStr);
    const fixedArgsStr = argsStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    console.log('fixed:', fixedArgsStr);
    console.log('parsed:', JSON.parse(fixedArgsStr));
}
