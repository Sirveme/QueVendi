// Guardar como extract_functions.js y ejecutar: node extract_functions.js

const fs = require('fs');

function extractFunctions(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Buscar funciones: async function, function, const x = function, const x = async function, const x = () =>
    const patterns = [
        /(?:async\s+)?function\s+(\w+)\s*\(/g,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(/g,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    ];
    
    const functions = new Set();
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            functions.add(match[1]);
        }
    });
    
    return Array.from(functions).sort();
}

console.log('=== FUNCIONES EN pos.js ===');
const posFunctions = extractFunctions('./pos.js');
posFunctions.forEach((fn, i) => console.log(`${i + 1}. ${fn}`));

console.log('\n=== FUNCIONES EN dashboard_principal.js ===');
const dashFunctions = extractFunctions('./dashboard_principal.js');
dashFunctions.forEach((fn, i) => console.log(`${i + 1}. ${fn}`));