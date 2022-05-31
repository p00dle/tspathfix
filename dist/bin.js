#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsPathFix = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const IGNORE_DIRS = [
    'node_modules'
];
async function getTsConfig(dir) {
    const filePath = path.join(dir, 'tsconfig.json');
    try {
        const fileContent = await fs.readFile(filePath, { encoding: 'utf8' });
        try {
            const tsConfig = JSON.parse(fileContent);
            const output = {
                baseUrl: tsConfig.compilerOptions.baseUrl ? path.join(dir, tsConfig.compilerOptions.baseUrl) : dir,
                outDir: tsConfig.compilerOptions.outDir ? path.join(dir, tsConfig.compilerOptions.outDir) : dir,
                paths: tsConfig.compilerOptions.paths
            };
            if (!output.paths || typeof output.paths !== 'object' || Object.keys(output.paths).length === 0) {
                console.info('paths property not present or invalid in tsconfig.json');
                process.exit(0);
            }
            return output;
        }
        catch (err) {
            console.error('Error parsing tsconfig file; be aware that the file needs to conform to JSON standards (no comments, no trailing commas');
            console.error(String(err));
            process.exit(1);
        }
    }
    catch (err) {
        console.error(`Unable to read or find tsconfig file: ${filePath} `);
        console.error(String(err));
        process.exit(1);
    }
}
function isJsOrDeclarationFile(file) {
    if (typeof file !== 'string')
        return false;
    return file.endsWith('.js') || file.endsWith('.d.ts');
}
const pathReplaceCache = {};
function createReplace(pathReplace, replaceWith, baseAbsolutePath) {
    if (!pathReplaceCache[pathReplace]) {
        pathReplaceCache[pathReplace] = [
            new RegExp(pathReplace.replace(/\*$/, '(.*)')),
            path.join(baseAbsolutePath, replaceWith.replace(/\*$/, ''))
        ];
    }
    return pathReplaceCache[pathReplace];
}
// TODO: add other glob patterns and handling mutliple mapping; so far only one supported is the one ending with * and only a single path per mapping
function fixPath(importPath, fileAbsoluteDir, config) {
    let importAbsolutePath = importPath;
    for (const [pathReplace, replacePath] of Object.entries(config.paths)) {
        const [regex, replaceWith] = createReplace(pathReplace, replacePath[0], config.outDir);
        importAbsolutePath = importAbsolutePath.replace(regex, (_, relativePath) => {
            return path.join(replaceWith, relativePath);
        });
    }
    if (importAbsolutePath !== importPath) {
        const importIsBelowFile = importAbsolutePath.startsWith(fileAbsoluteDir);
        if (importIsBelowFile) {
            return importAbsolutePath.replace(fileAbsoluteDir, '.');
        }
        let dirs = [];
        let currentDir = fileAbsoluteDir;
        while (!importAbsolutePath.startsWith(currentDir) && currentDir !== '.') {
            dirs.push('..');
            currentDir = path.join(currentDir, '..');
        }
        return dirs.join('/') + '/' + importAbsolutePath.replace(currentDir, '');
    }
    else {
        return importPath;
    }
}
function fixSlashes(str) {
    return str.replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/\/\//g, '/');
}
let filesFound = 0;
let filesUpdated = 0;
let runningProcesses = 0;
let taskFinishedResolve = null;
async function fixFileImports(file, config) {
    processRunning(true);
    filesFound++;
    const fileContent = await fs.readFile(file, { encoding: 'utf8' });
    const fixedFileContent = fileContent.replace(/((im|ex)port\s*(type)*\s*{[^}]*}\s*from\s*['"][^'"]+['"])|(require\s*\(\s*['"][^'"]+['"]\s*\))/g, match => {
        return match.replace(/['"][^'"]+['"]/, match => {
            const quote = match[0] === '"' ? '"' : '\'';
            const importPath = match.slice(1, match.length - 1);
            const fixedImportPath = quote + fixPath(importPath, path.dirname(file), config) + quote;
            return fixSlashes(fixedImportPath);
        });
    });
    if (fixedFileContent !== fileContent) {
        filesUpdated++;
        await fs.writeFile(file, fixedFileContent);
    }
    processRunning(false);
}
function processRunning(isStarting) {
    if (isStarting) {
        runningProcesses++;
    }
    else {
        runningProcesses--;
        if (runningProcesses === 0 && taskFinishedResolve)
            taskFinishedResolve();
    }
}
async function traverse(dir, config) {
    processRunning(true);
    for (const file of await fs.readdir(dir)) {
        const absolutePath = path.join(dir, file);
        if ((await fs.stat(absolutePath)).isDirectory() && !IGNORE_DIRS.includes(file))
            traverse(absolutePath, config);
        if (isJsOrDeclarationFile(absolutePath))
            fixFileImports(absolutePath, config);
    }
    processRunning(false);
}
async function tsPathFix(projectDir = process.cwd()) {
    const config = await getTsConfig(projectDir);
    traverse(config.outDir, config);
    await new Promise(resolve => {
        taskFinishedResolve = resolve;
    });
    console.info(`Files found: ${filesFound}`);
    console.info(`Files updated: ${filesUpdated}`);
    process.exit(0);
}
exports.tsPathFix = tsPathFix;
tsPathFix();
