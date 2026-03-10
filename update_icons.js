const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'src/components/ui/icons');
let files;
try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js');
} catch (e) {
    console.error("Directory not found", e);
    process.exit(1);
}

function getLuminance(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

files.forEach(file => {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Extract all unique fill colors
    const regex = /fill:\s*\"(#.*?)\"/g;
    let match;
    const colors = new Set();
    while ((match = regex.exec(content)) !== null) {
        colors.add(match[1]);
    }

    const sortedColors = Array.from(colors).sort((a, b) => getLuminance(b) - getLuminance(a)); // from lightest to darkest

    content = content.replace(/fill:\s*\"(#.*?)\"/g, (match, hex) => {
        const index = sortedColors.indexOf(hex);
        let opacity = 1;

        // Most SVGs have #ccc, #535252, #575756 
        // Lightest (#ccc) -> usually the biggest shape -> opacity 1
        // Darkest -> opacity 0.4
        if (sortedColors.length === 2) {
            opacity = index === 0 ? 1 : 0.4;
        } else if (sortedColors.length >= 3) {
            if (index === 0) opacity = 1;
            else if (index === sortedColors.length - 1) opacity = 0.3;
            else opacity = 0.6;
        }

        return "fill: props.color || \"#FFF\", opacity: " + opacity;
    });

    fs.writeFileSync(filePath, content, 'utf8');
});
console.log('Iconos actualizados correctamente!');
