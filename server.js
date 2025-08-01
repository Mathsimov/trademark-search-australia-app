const http = require('http');
const fs = require('fs');
const path = require('path');

// Directory used for caching detail pages. Caching persists across
// requests and server restarts to minimise network traffic for
// subsequent searches on the same host. Each search term gets its own
// JSON file keyed by a URI‑encoded version of the term. Within each
// file we store a mapping from full detail URLs to parsed detail
// objects. When processing a name, we always hit the search page to
// discover up‑to‑date detail links but reuse cached detail pages
// whenever possible. New detail links are fetched on demand and the
// cache file is updated accordingly.
const cacheDir = path.join(__dirname, 'cache');
if (!fs.existsSync(cacheDir)) {
    try {
        fs.mkdirSync(cacheDir);
    } catch (err) {
        // Ignore errors if directory creation fails; caching simply won't work
        console.error('Unable to create cache directory', err);
    }
}

function loadCache(name) {
    const safeName = encodeURIComponent(name);
    const file = path.join(cacheDir, safeName + '.json');
    if (fs.existsSync(file)) {
        try {
            const data = fs.readFileSync(file, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Error reading cache file', file, err);
            return {};
        }
    }
    return {};
}

function saveCache(name, data) {
    const safeName = encodeURIComponent(name);
    const file = path.join(cacheDir, safeName + '.json');
    try {
        fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    } catch (err) {
        console.error('Error writing cache file', file, err);
    }
}

async function fetchPage(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Node.js trademark search tool)'
        }
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }
    return await res.text();
}

function extractDetailLinks(html) {
    const regex = /\/australia\/trademark\/trademark-detail\/\d+\/[^"'>]+/gi;
    const matches = html.match(regex) || [];
    return Array.from(new Set(matches));
}

function parseDetail(html) {
    function extractTableValue(label) {
        const regex = new RegExp(
            `<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
            'i'
        );
        const m = html.match(regex);
        if (m) {
            const raw = m[1]
                .replace(/<[^>]*>/g, ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return raw;
        }
        return '';
    }

    const applicationNumber = extractTableValue('Application Number');
    const wordMark = extractTableValue('Word Mark');
    const filingDate = extractTableValue('Filing Date');
    let ownerName = '';
    let ownerAddress = '';
    {
        const ownerMatch = html.match(/<th[^>]*>\s*Trademark\s*Owner\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
        if (ownerMatch) {
            const tdHtml = ownerMatch[1];
            const divRegex = /<div[^>]*>([\s\S]*?)<\/div>/gi;
            const parts = [];
            let d;
            while ((d = divRegex.exec(tdHtml)) !== null) {
                let text = d[1]
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/&nbsp;/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                text = text.replace(/\s*[-]+>\s*/g, ' ');
                if (text) parts.push(text);
            }
            if (parts.length > 0) {
                ownerName = parts[0];
                if (parts.length > 1) {
                    ownerAddress = parts.slice(1).join(' ');
                }
            } else {
                let cleaned = tdHtml
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/&nbsp;/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                const arrowSplit = cleaned.split(/\s*[-]+>\s*|\s*→\s*|\s*&gt;\s*/i).filter(Boolean);
                if (arrowSplit.length > 0) {
                    ownerName = arrowSplit[0].trim();
                    if (arrowSplit.length > 1) {
                        ownerAddress = arrowSplit.slice(1).join(' ').trim();
                    }
                } else {
                    const withoutArrow = cleaned.replace(/\s*[-]+>\s*/g, ' ').trim();
                    ownerName = withoutArrow;
                }
            }
        }
    }

    let status = '';
    if (/\sLIVE\s/i.test(html)) {
        status = 'LIVE';
    } else if (/\sDEAD\s/i.test(html)) {
        status = 'DEAD';
    }
    let statusDesc = '';
    {
        const match = html.match(/Current\s+Status\s+([^<\n]+)/i);
        if (match) {
            statusDesc = match[1].trim();
        }
    }

    const classes = [];
    {
        const regex = /Class\s*(\d{3})/gi;
        let m;
        const set = new Set();
        while ((m = regex.exec(html)) !== null) {
            set.add(m[1]);
        }
        classes.push(...set);
    }

    const owner = ownerAddress ?
        `${ownerName}, ${ownerAddress}` :
        ownerName;
    return {
        applicationNumber,
        wordMark,
        ownerName,
        ownerAddress,
        owner,
        filingDate,
        status,
        statusDesc,
        classes
    };
}

async function processName(name) {
    const baseUrl = 'https://www.trademarkelite.com';
    const searchUrl = `${baseUrl}/australia/trademark/trademark-search.aspx?sw=${encodeURIComponent(name)}`;
    // Always fetch the search page to discover current detail links. Even if
    // we have cached details for previous runs, new filings may appear and
    // should be incorporated into the result.
    const searchHtml = await fetchPage(searchUrl);
    const detailLinks = extractDetailLinks(searchHtml);
    const details = [];
    let hasLive = false;
    let hasRedMark = false;
    // Load cached details for this name if available
    let cached = {};
    try {
        const cache = loadCache(name);
        cached = cache && cache.detailCache ? cache.detailCache : {};
    } catch (err) {
        cached = {};
    }
    for (const relLink of detailLinks) {
        const url = baseUrl + relLink;
        // If this detail page has been cached previously, reuse it
        if (cached[url]) {
            const info = cached[url];
            // ensure the detailUrl property exists
            if (!info.detailUrl) {
                info.detailUrl = url;
            }
            details.push(info);
            if (info.status === 'LIVE') {
                hasLive = true;
                const includes009 = info.classes.includes('009');
                const includes028 = info.classes.includes('028');
                const includes041 = info.classes.includes('041');
                if (includes009 || includes028 || includes041) {
                    hasRedMark = true;
                }
            }
            continue;
        }
        // Otherwise fetch and parse it now
        try {
            const html = await fetchPage(url);
            const info = parseDetail(html);
            info.detailUrl = url;
            details.push(info);
            // Store in cache for future use
            cached[url] = info;
            if (info.status === 'LIVE') {
                hasLive = true;
                const includes009 = info.classes.includes('009');
                const includes028 = info.classes.includes('028');
                const includes041 = info.classes.includes('041');
                if (includes009 || includes028 || includes041) {
                    hasRedMark = true;
                }
            }
        } catch (err) {
            details.push({
                error: `Error processing detail page: ${err.message}`
            });
        }
    }
    // Save updated cache back to disk
    saveCache(name, { detailCache: cached });
    // Compute a summary score based on live filings and relevant classes
    let score;
    let explanation;
    if (!hasLive) {
        score = 'Green';
        explanation = 'No live trademark registrations were found for this name.';
    } else if (hasRedMark) {
        score = 'Red';
        explanation = 'At least one live filing lists classes 009, 028 or 041.';
    } else {
        score = 'Yellow';
        explanation = 'Live filings exist, but none contain 009, 028 or 041.';
    }
    return {
        score,
        explanation,
        details
    };
}

function serveStatic(urlPath, res) {
    const fileMap = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml'
    };
    let filePath = path.join(__dirname, 'public', urlPath);
    if (urlPath === '/' || urlPath === '') {
        filePath = path.join(__dirname, 'public', 'index.html');
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = fileMap[ext] || 'application/octet-stream';
        const data = fs.readFileSync(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.end(data);
        return true;
    }
    return false;
}

const server = http.createServer(async (req, res) => {
    const {
        method,
        url
    } = req;
    try {
        if (url === '/api/search' && method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk;
            });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    let {
                        names
                    } = data;
                    if (!names || typeof names !== 'string') {
                        res.statusCode = 400;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                            error: 'Missing or invalid "names" field.'
                        }));
                        return;
                    }
                    const list = names
                        .split(/[\n,]+/)
                        .map(s => s.trim())
                        .filter(Boolean);
                    const result = {};
                    for (const n of list) {
                        try {
                            const info = await processName(n);
                            result[n] = info;
                        } catch (err) {
                            result[n] = {
                                error: err.message
                            };
                        }
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({
                        error: 'Invalid JSON body.'
                    }));
                }
            });
            return;
        }
        if (serveStatic(url, res)) {
            return;
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not Found');
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: 'Internal server error'
        }));
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Trademark search server running at http://localhost:${PORT}`);
});