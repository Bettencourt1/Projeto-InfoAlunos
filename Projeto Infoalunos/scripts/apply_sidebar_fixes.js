const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Instead of naive static prefix rules, resolve broken sidebar hrefs to the
// single matching HTML file in the project and write a proper relative path
// from the source file to the target. This avoids broken links when pages are
// nested in subfolders (e.g. Disciplina/*.html).

// collect all html files for basename matching
const allHtmlFiles = walk(root);

function resolveToRelative(filePath, href, baseResolved) {
  // ignore absolute URLs and anchors
  if (/^(https?:|mailto:|#)/i.test(href)) return null;

  const srcDir = path.dirname(filePath);
  // If the document declares a <base href>, resolution at runtime will use
  // that base instead of the document directory. Respect baseResolved when
  // checking whether the current href is valid.
  let resolved;
  if (baseResolved && typeof baseResolved === 'string' && !baseResolved.startsWith('http')) {
    resolved = path.resolve(baseResolved, href);
  } else {
    resolved = path.resolve(srcDir, href);
  }
  if (fs.existsSync(resolved)) return null; // already valid

  // find candidate files matching the target basename
  const basename = path.basename(href);
  const matches = allHtmlFiles.filter(f => path.basename(f).toLowerCase() === basename.toLowerCase());
  if (matches.length === 1) {
    let rel;
    // If this file declares a <base href="..">, compute path relative to that base
    if (baseResolved && typeof baseResolved === 'string' && !baseResolved.startsWith('http')) {
      rel = path.relative(baseResolved, matches[0]).replace(/\\/g, '/');
      // when using base, keep it clean (no leading ./)
    } else {
      rel = path.relative(srcDir, matches[0]).replace(/\\/g, '/');
      if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
    }
    return rel;
  }

  return null;
}

let modified = 0;
let filesChanged = 0;

function walk(dir) {
  let results = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) results = results.concat(walk(p));
    else if (st.isFile() && p.endsWith('.html')) results.push(p);
  }
  return results;
}

const files = walk(root);
for (const filePath of files) {
  let s = fs.readFileSync(filePath, 'utf8');

  // find nav block(s)
  const navRegex = /<nav class="sidebar-nav">[\s\S]*?<\/nav>/g;
  const blocks = s.match(navRegex);
  if (!blocks) continue;

  // detect <base href="..."> so we can compute relative links correctly
  const baseRe = /<base\s+href=["']([^"']+)["']/i;
  const baseMatch = baseRe.exec(s);
  let baseResolved = path.dirname(filePath);
  if (baseMatch) {
    const baseHref = baseMatch[1];
    if (baseHref.startsWith('http')) {
      baseResolved = baseHref; // remote base - we'll skip fs checks for these
    } else if (baseHref.startsWith('/')) {
      baseResolved = path.resolve(root, baseHref.replace(/^\/+/, ''));
    } else {
      baseResolved = path.resolve(path.dirname(filePath), baseHref);
    }
  }

  let newS = s;
  for (const block of blocks) {
    let replacedBlock = block.replace(/href="([^"]+)"/g, (m, href) => {
      const cleaned = href.trim();
      // ignore absolute URLs and anchors and mailto
      if (/^(https?:|mailto:|#)/i.test(cleaned)) return m;
      const newHref = resolveToRelative(filePath, cleaned, baseResolved);
      if (newHref) {
        modified++;
        return `href="${newHref}"`;
      }
      return m;
    });
    if (replacedBlock !== block) {
      newS = newS.replace(block, replacedBlock);
      filesChanged++;
    }
  }

  if (newS !== s) fs.writeFileSync(filePath, newS, 'utf8');
}

console.log(`Files changed: ${filesChanged}, hrefs updated: ${modified}`);
if (filesChanged === 0) process.exit(1);
