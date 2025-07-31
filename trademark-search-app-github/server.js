const http = require('http');
const fs = require('fs');
const path = require('path');

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
    const searchHtml = await fetchPage(searchUrl);
    const detailLinks = extractDetailLinks(searchHtml);
    const details = [];
    let hasLive = false;
    let hasRedMark = false;
    for (const relLink of detailLinks) {
        try {
            const url = baseUrl + relLink;
            const html = await fetchPage(url);
            const info = parseDetail(html);
            info.detailUrl = url;
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
        } catch (err) {
            details.push({
                error: `Error processing detail page: ${err.message}`
            });
        }
    }
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