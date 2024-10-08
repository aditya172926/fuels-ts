import { readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import replace from 'replace';
import { fileURLToPath } from 'url';

type Link = {
  link: string;
  text: string;
  items: Link[];
  collapsed?: boolean;
};

type RegexReplacement = {
  regex: string;
  replacement: string;
};

/**
 * Post build script to trim off undesired leftovers from Typedoc, restructure directories and generate json for links.
 */
const filename = fileURLToPath(import.meta.url);
const docsDir = join(dirname(filename), '../src/');
const apiDocsDir = join(docsDir, '/api');

const filesToRemove = ['api/_media'];

const filePathReplacements: RegexReplacement[] = [];
const secondaryEntryPoints = ['-index.md', '-test_utils.md', '-cli_utils.md'];
const toFlattern = ['classes', 'interfaces', 'enumerations'];

const { log } = console;

/**
 * Removes unwanted files and dirs generated by typedoc.
 */
const removeUnwantedFiles = () =>
  filesToRemove.forEach((dirPath) => {
    const fullDirPath = join(docsDir, dirPath);
    rmSync(fullDirPath, { recursive: true, force: true });
  });

/**
 * Generates a json file containing the links for the sidebar to be used by vitepress.
 */
const exportLinksJson = () => {
  const links: Link = { link: '/api/', text: 'API', collapsed: true, items: [] };
  const directories = readdirSync(apiDocsDir);
  directories
    .filter((directory) => !directory.endsWith('.md'))
    .forEach((directory) => {
      links.items.push({ text: directory, link: `/api/${directory}/`, collapsed: true, items: [] });
      readdirSync(join(apiDocsDir, directory))
        .filter((file) => {
          // Exclude index files and files related to secondary entry points
          const isIndexFile = file.endsWith('index.md');
          const isSecondaryEntryPoint = secondaryEntryPoints.some((entryPoint) =>
            file.includes(entryPoint.replace('_', '-').replace('.md', ''))
          );
          return !isIndexFile && !isSecondaryEntryPoint;
        })
        .forEach((file) => {
          const index = links.items.findIndex((item) => item.text === directory);
          if (index !== -1) {
            const name = file.split('.')[0];
            links.items[index].items.push({
              text: name,
              link: `/api/${directory}/${name}`,
              items: [],
            });
          }
        });
    });
  writeFileSync('.typedoc/api-links.json', JSON.stringify(links));
};

const digRecursively = (startingPath: string, rootPackagePath: string, rootPackageName: string) => {
  const subDirs = readdirSync(startingPath);
  subDirs.forEach((dirName) => {
    const secondaryDirPath = join(startingPath, dirName);
    if (toFlattern.includes(dirName)) {
      const secondaryDirFiles = readdirSync(secondaryDirPath);

      secondaryDirFiles.forEach((file) => {
        renameSync(join(secondaryDirPath, file), join(rootPackagePath, file));
        const capitalRootPackageName =
          rootPackageName.charAt(0).toUpperCase() + rootPackageName.slice(1);
        const filePathToReplace = startingPath.replace(rootPackagePath, rootPackageName);
        filePathReplacements.push({
          regex: `${filePathToReplace}/${dirName}/${file}`,
          replacement: `${capitalRootPackageName}/${file}`,
        });
      });

      rmSync(secondaryDirPath, { recursive: true, force: true });
    } else {
      if (statSync(secondaryDirPath).isDirectory()) {
        digRecursively(secondaryDirPath, rootPackagePath, rootPackageName);
      }

      if (dirName === 'index.md') {
        const pathAfterRoot = secondaryDirPath.replace(`${rootPackagePath}/`, '');
        const pathSegments = pathAfterRoot.split('/');
        if (pathSegments.length - 1 > 0) {
          const newIndexFileName =
            pathSegments[pathSegments.length - 2] === 'index'
              ? `src-index.md`
              : `${pathSegments[pathSegments.length - 2]}-index.md`;
          renameSync(secondaryDirPath, join(rootPackagePath, newIndexFileName));
          filePathReplacements.push({
            regex: `${pathAfterRoot}`,
            replacement: `./${newIndexFileName}`,
          });
        }
      }
    }
  });
};

/**
 * Flattens the module files generated by typedoc. Only necessary where a package
 * has multiple entry points.
 */
const flattenSecondaryModules = () => {
  const primaryDirs = readdirSync(apiDocsDir);
  primaryDirs.forEach((primaryDirName) => {
    const primaryDirPath = join(apiDocsDir, primaryDirName);
    if (statSync(primaryDirPath).isDirectory()) {
      digRecursively(primaryDirPath, primaryDirPath, primaryDirName);
    }
  });
};

/**
 * Capitalise the Primary Directories
 */
const capitalisePrimaryDirs = () => {
  const primaryDirs = readdirSync(apiDocsDir);
  primaryDirs
    .filter((directory) => !directory.includes('.md'))
    .forEach((primaryDirName) => {
      const capitalise = primaryDirName.charAt(0).toUpperCase() + primaryDirName.slice(1);
      const primaryDirPath = join(apiDocsDir, primaryDirName);
      renameSync(primaryDirPath, join(apiDocsDir, capitalise));
      filePathReplacements.push({
        regex: `${primaryDirName}/index.md`,
        replacement: `${capitalise}/index.md`,
      });
    });
};

/**
 * Remove empty directories
 */
const cleanupDirectories = (dirPath: string) => {
  const primaryDirs = readdirSync(dirPath);
  primaryDirs.forEach((dir) => {
    const fullPath = join(dirPath, dir);
    if (statSync(fullPath).isDirectory()) {
      cleanupDirectories(fullPath);
    }
  });
  if (readdirSync(dirPath).length === 0) {
    rmdirSync(dirPath);
  }
};

/**
 * Recreates the generated typedoc links
 */
const recreateInternalLinks = () => {
  const topLevelDirs = readdirSync(apiDocsDir);

  const prefixReplacements: RegexReplacement[] = [
    // Prefix/Typedoc cleanups
    { regex: 'classes/', replacement: './' },
    { regex: 'interfaces/', replacement: './' },
    { regex: 'enumerations/', replacement: './' },
    { regex: '../../../', replacement: '../' },
    { regex: '../../', replacement: '../' },
    { regex: 'index/index', replacement: 'index' },
    { regex: '.././', replacement: './' },
    // Resolves `[plugin:vite:vue] Element is missing end tag.` error
    { regex: '<', replacement: '&lt;' },
  ];

  const internalLinksReplacement = [...filePathReplacements, ...prefixReplacements];

  topLevelDirs.forEach((dir) => {
    internalLinksReplacement.forEach(({ regex, replacement }) => {
      replace({
        regex,
        replacement,
        paths: [join(apiDocsDir, dir)],
        recursive: true,
        silent: true,
      });
    });
  });
};

const main = () => {
  log('Cleaning up API docs.');
  removeUnwantedFiles();
  flattenSecondaryModules();
  capitalisePrimaryDirs();
  cleanupDirectories(apiDocsDir);
  exportLinksJson();
  recreateInternalLinks();
};

main();
