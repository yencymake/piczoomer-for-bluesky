const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) {
    throw new Error('Only Manifest V3 packages are supported.');
}

if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
    throw new Error(`Invalid Chrome extension version: ${manifest.version}`);
}

const packageFiles = [
    'manifest.json',
    'content.js',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
];

for (const relativePath of packageFiles) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.statSync(fullPath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Missing release file: ${relativePath}`);
    }
}

const releaseDir = path.join(repoRoot, 'release');
const zipPath = path.join(releaseDir, `piczoomer-v${manifest.version}.zip`);
fs.mkdirSync(releaseDir, { recursive: true });

function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < table.length; i += 1) {
        let c = i;
        for (let bit = 0; bit < 8; bit += 1) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
}

const crc32Table = makeCrc32Table();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11)
        | (date.getMinutes() << 5)
        | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9)
        | ((date.getMonth() + 1) << 5)
        | date.getDate();
    return { time, day };
}

function writeZip(entries, destination) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, 'utf8');
        const source = fs.readFileSync(entry.fullPath);
        const compressed = zlib.deflateRawSync(source, { level: zlib.constants.Z_BEST_COMPRESSION });
        const checksum = crc32(source);
        const stats = fs.statSync(entry.fullPath);
        const stamp = dosTimestamp(stats.mtime);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(stamp.time, 10);
        localHeader.writeUInt16LE(stamp.day, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(source.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(stamp.time, 12);
        centralHeader.writeUInt16LE(stamp.day, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(source.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + compressed.length;
    }

    const centralOffset = offset;
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);

    fs.writeFileSync(destination, Buffer.concat([...localParts, centralDirectory, end]));
}

writeZip(
    packageFiles.map((relativePath) => ({
        name: relativePath.replace(/\\/g, '/'),
        fullPath: path.join(repoRoot, relativePath),
    })),
    zipPath
);

console.log(`Created ${zipPath}`);
