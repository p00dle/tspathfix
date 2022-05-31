#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';

const IGNORE_DIRS = [
  'node_modules'
]

interface TsConfigCompilerOptions {
  baseUrl: string;
  outDir: string;
  paths: Record<string, string[]>;
}

async function getTsConfig(dir: string): Promise<TsConfigCompilerOptions> {
  const filePath = path.join(dir, 'tsconfig.json');
  try {
    const fileContent = await fs.readFile(filePath, {encoding: 'utf8'});
    try {
      const tsConfig: {compilerOptions: TsConfigCompilerOptions} = JSON.parse(fileContent);
      const output = {
        baseUrl: tsConfig.compilerOptions.baseUrl ? path.join(dir, tsConfig.compilerOptions.baseUrl) : dir,
        outDir: tsConfig.compilerOptions.outDir ? path.join(dir, tsConfig.compilerOptions.outDir) : dir,
        paths: tsConfig.compilerOptions.paths
      }
      if (!output.paths || typeof output.paths !== 'object' || Object.keys(output.paths).length === 0) {
        console.info('paths property not present or invalid in tsconfig.json');
        process.exit(0);
      }
      return output;
    } catch (err) {
      console.error('Error parsing tsconfig file; be aware that the file needs to conform to JSON standards (no comments, no trailing commas');
      console.error(String(err));
      process.exit(1);
    }
  } catch (err) {
    console.error(`Unable to read or find tsconfig file: ${filePath} `);
    console.error(String(err));
    process.exit(1);
  }
}

function isJsOrDeclarationFile(file: string): boolean {
  if (typeof file !== 'string') return false;
  return file.endsWith('.js') || file.endsWith('.d.ts');
}

const pathReplaceCache: Record<string, [RegExp, string]> = {}

function createReplace(pathReplace: string, replaceWith: string, baseAbsolutePath: string): [RegExp, string] {
  if (!pathReplaceCache[pathReplace]) {
    pathReplaceCache[pathReplace] = [
      new RegExp(pathReplace.replace(/\*$/, '(.*)')),
      path.join(baseAbsolutePath, replaceWith.replace(/\*$/, ''))
    ]
  }
  return pathReplaceCache[pathReplace];
}

// TODO: add other glob patterns and handling mutliple mapping; so far only one supported is the one ending with * and only a single path per mapping
function fixPath(importPath: string, fileAbsoluteDir: string, config: TsConfigCompilerOptions): string {
  let importAbsolutePath = importPath;
  for (const [pathReplace, replacePath] of Object.entries(config.paths)) {
    const [regex, replaceWith] = createReplace(pathReplace, replacePath[0], config.outDir);
    importAbsolutePath = importAbsolutePath.replace(regex, (_,relativePath) => {
      return path.join(replaceWith, relativePath);
    });
  }
  if (importAbsolutePath !== importPath) {
    const importIsBelowFile = importAbsolutePath.startsWith(fileAbsoluteDir);
    if (importIsBelowFile) {
      return importAbsolutePath.replace(fileAbsoluteDir, '.');
    }
    let dirs: string[] = [];
    let currentDir = fileAbsoluteDir;
    while (!importAbsolutePath.startsWith(currentDir) && currentDir !== '.') {
      dirs.push('..');
      currentDir = path.join(currentDir, '..');
    }
    return dirs.join('/') + '/' + importAbsolutePath.replace(currentDir, '');
  } else {
    return importPath;
  }
}

function fixSlashes(str: string): string {
  return str.replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/\/\//g, '/');
}

let filesFound = 0;
let filesUpdated = 0;
let runningProcesses = 0;
let taskFinishedResolve: (() => any) | null = null;

async function fixFileImports(file: string, config: TsConfigCompilerOptions) {
  processRunning(true);
  filesFound++;
  const fileContent = await fs.readFile(file, {encoding: 'utf8'});
  const fixedFileContent = fileContent.replace(/((im|ex)port\s*(type)*\s*{[^}]*}\s*from\s*['"][^'"]+['"])|(require\s*\(\s*['"][^'"]+['"]\s*\))/g, match => {
    return match.replace(/['"][^'"]+['"]/, match => {
      const quote = match[0] === '"' ? '"' : '\'';
      const importPath = match.slice(1, match.length - 1);
      const fixedImportPath = quote + fixPath(importPath, path.dirname(file), config) + quote;
      return fixSlashes(fixedImportPath);
    })
  });
  if (fixedFileContent !== fileContent) {
    filesUpdated++;
    await fs.writeFile(file, fixedFileContent);
  }
  processRunning(false);
}

function processRunning(isStarting: boolean) {
  if (isStarting) {
    runningProcesses++;
  } else {
    runningProcesses--;
    if (runningProcesses === 0 && taskFinishedResolve) taskFinishedResolve();
  }
}


async function traverse(dir: string, config: TsConfigCompilerOptions) {
  processRunning(true);
  for (const file of await fs.readdir(dir)) {
    const absolutePath = path.join(dir, file);
    if ((await fs.stat(absolutePath)).isDirectory() && !IGNORE_DIRS.includes(file)) traverse(absolutePath, config);
    if (isJsOrDeclarationFile(absolutePath)) fixFileImports(absolutePath, config);
  }
  processRunning(false);
}

export async function tsPathFix(projectDir = process.cwd()) {
  const config = await getTsConfig(projectDir);
  traverse(config.outDir, config);
  await new Promise<void>(resolve => {
    taskFinishedResolve = resolve;
  });
  console.info(`Files found: ${filesFound}`);
  console.info(`Files updated: ${filesUpdated}`);
  process.exit(0);
}


tsPathFix();