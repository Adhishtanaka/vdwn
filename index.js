#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const inquirer = require('inquirer');
const cliProgress = require('cli-progress');
const colors = require('ansi-colors');
const execAsync = require('util').promisify(exec);

async function main() {
    try {
        await ensureDependencies();
        // Prompt for URL first
        const { url } = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Enter the Video URL:',
                validate: input => input ? true : 'URL cannot be empty'
            }
        ]);

    // If YouTube, ask for download type and quality
    if (isYouTube(url)) {
            const ytAnswers = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'downloadType',
                    message: 'Download type:',
                    choices: ['video', 'audio-only']
                },
                {
                    type: 'list',
                    name: 'quality',
                    message: 'Select video quality:',
                    choices: ['1440p', '1080p', '720p', 'best'],
                    when: answers => answers.downloadType === 'video'
                },
                {
                    type: 'input',
                    name: 'output',
                    message: 'Enter output directory:',
                    default: './downloads'
                }
            ]);
            ensureOutputDirectory(ytAnswers.output);
            await downloadY({ url, ...ytAnswers });
        } else {
            // For non-YouTube, just ask for output dir
            const { output } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'output',
                    message: 'Enter output directory:',
                    default: './downloads'
                }
            ]);
            ensureOutputDirectory(output);
            await downloadO({ url, output });
        }

        console.log('\nDownload completed successfully!');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

async function ensureDependencies() {
  const deps = [
    { name: 'ffmpeg', versionCmd: '-version' },
    { name: 'yt-dlp', versionCmd: '--version' }
  ];
  const missing = [];
  await Promise.all(deps.map(async dep => {
    try { await execAsync(`${dep.name} ${dep.versionCmd}`); }
    catch { missing.push(dep.name); }
  }));
  if (missing.length) await installDependencies(missing);
}

async function installDependencies(missingDeps) {
    console.log('Missing dependencies:', missingDeps.join(', '));
    const platform = process.platform;
    if (platform === 'win32') {
        await installWithScoop(missingDeps);
    } else if (platform === 'darwin') {
        await installWithBrew(missingDeps);
    } else if (platform === 'linux') {
        await installWithApt(missingDeps);
    } else {
        throw new Error('Unsupported operating system');
    }
}

async function installWithBrew(deps) {
    try {
        await execAsync('brew --version');
    } catch {
        throw new Error('Homebrew is not installed. Please install Homebrew first: https://brew.sh/');
    }
    for (const dep of deps) {
        console.log(`Installing ${dep} via Homebrew...`);
        await execAsync(`brew install ${dep}`);
    }
}

async function installWithApt(deps) {
    try {
        await execAsync('apt --version');
    } catch {
        throw new Error('apt is not available. Please install dependencies manually.');
    }
    for (const dep of deps) {
        console.log(`Installing ${dep} via apt...`);
        // Use sudo if not root
        const prefix = process.getuid && process.getuid() !== 0 ? 'sudo ' : '';
        await execAsync(`${prefix}apt-get update`);
        await execAsync(`${prefix}apt-get install -y ${dep}`);
    }
}

async function installWithScoop(deps) {
    try {
        await execAsync('scoop --version');
    } catch {
        console.log('Installing Scoop...');
        const psCommand = 'Set-ExecutionPolicy RemoteSigned -scope CurrentUser; iwr -useb get.scoop.sh | iex';
        await execAsync(`powershell -Command "${psCommand}"`);
    }

    for (const dep of deps) {
        console.log(`Installing ${dep} via Scoop...`);
        await execAsync(`scoop install ${dep}`);
    }
}

const isYouTube = url => /youtube\.com|youtu\.be|m\.youtube\.com/.test(url);

function ensureOutputDirectory(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`Created output directory: ${dir}`);
    }
}

function getFormatSelector(answers) {
    if (answers.downloadType === 'audio-only') return 'bestaudio/best';

    const qualityMap = {
        '1440p': 'bestvideo[height<=1440]+bestaudio/best[ext=mp4]',
        '1080p': 'bestvideo[height<=1080]+bestaudio/best[ext=mp4]',
        '720p': 'bestvideo[height<=720]+bestaudio/best[ext=mp4]',
        'best': 'best[ext=mp4]'
    };    

    return qualityMap[answers.quality];
}

async function downloadO(answers) {
    // Build output filename from URL or use a default
    const url = answers.url;
    const outputDir = answers.output;
    const urlObj = new URL(url);
    let filename = urlObj.pathname.split('/').pop() || 'output';
    filename = filename.split('?')[0];
    if (!filename.match(/\.(mp4|mkv|webm|mp3|mov|avi)$/i)) {
        filename += (answers.downloadType && answers.downloadType === 'audio-only') ? '.mp3' : '.mp4';
    }
    const outputPath = join(outputDir, filename);

    // Get duration first (ffprobe)
    const getDuration = async () => {
        try {
            const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`);
            return parseFloat(stdout.trim());
        } catch {
            return null;
        }
    };

    const totalDuration = await getDuration();
    const progressBar = new cliProgress.SingleBar({
        format: 'Progress |' + colors.cyan('{bar}') + '| {percentage}% || {currentTime}/{totalTime} sec',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    console.log(`\nStarting ffmpeg download to ${outputPath} ...\n`);

    return new Promise((resolve, reject) => {
        let started = false;
        let lastPercent = 0;
        progressBar.start(100, 0, {
            currentTime: '0',
            totalTime: totalDuration ? totalDuration.toFixed(1) : '?'
        });

        const ffmpeg = spawn('ffmpeg', [
            '-i', url,
            ...(answers.downloadType && answers.downloadType === 'audio-only' ? ['-vn', '-acodec', 'copy'] : ['-c', 'copy']),
            '-progress', 'pipe:2',
            '-nostats',
            '-loglevel', 'error',
            outputPath
        ]);

        ffmpeg.stderr.on('data', data => {
            const str = data.toString();
            // Parse time= from ffmpeg output
            const timeMatch = str.match(/time=([\d:.]+)/);
            if (timeMatch && totalDuration) {
                // Convert time to seconds
                const t = timeMatch[1].split(':').reverse();
                let seconds = 0;
                if (t.length === 3) seconds = (+t[2]) * 3600 + (+t[1]) * 60 + (+t[0]);
                else if (t.length === 2) seconds = (+t[1]) * 60 + (+t[0]);
                else seconds = +t[0];
                const percent = Math.min(100, Math.round((seconds / totalDuration) * 100));
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    progressBar.update(percent, {
                        currentTime: seconds.toFixed(1),
                        totalTime: totalDuration.toFixed(1)
                    });
                }
            }
        });

        ffmpeg.on('close', code => {
            progressBar.update(100, {
                currentTime: totalDuration ? totalDuration.toFixed(1) : '?',
                totalTime: totalDuration ? totalDuration.toFixed(1) : '?'
            });
            progressBar.stop();
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}`));
        });
        ffmpeg.on('error', err => {
            progressBar.stop();
            reject(err);
        });
    });
}

async function downloadY(answers) {
    const formatSelector = getFormatSelector(answers);
    const outputTemplate = join(answers.output, '%(title)s.%(ext)s');

    const progressBar = new cliProgress.SingleBar({
        format: 'Progress |' + colors.cyan('{bar}') + '| {percentage}% || {status} || Speed: {speed} || ETA: {eta}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    const args = [
        '--format', formatSelector,
        '--output', outputTemplate,
        '--progress',
        '--newline',
        answers.url
    ];

    if (answers.downloadType === 'audio-only') {
        args.push('--extract-audio', '--audio-format', 'mp3');
    }

    console.log(`\nStarting download (${answers.downloadType === 'audio-only' ? 'audio only' : answers.quality})...\n`);

    return new Promise((resolve, reject) => {
        const ytdlp = spawn('yt-dlp', args);
        let totalStreams = 1;
        let currentStream = 0;
        let isDownloading = false;
        let progressStarted = false;

        let buffer = '';
        let lastProgress = -1;

        ytdlp.stdout.on('data', data => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (!line.trim()) continue;

                // Detect number of formats being downloaded
                if (line.includes('Downloading') && line.includes('format(s)')) {
                    const formatMatch = line.match(/Downloading\s+(\d+)\s+format/);
                    if (formatMatch) {
                        totalStreams = parseInt(formatMatch[1]);
                    }
                }

                // Start progress bar on first download line
                if (line.includes('[download]') && line.includes('%') && !progressStarted) {
                    progressBar.start(100, 0, {
                        status: 'Downloading...',
                        speed: '0KB/s',
                        eta: 'Unknown'
                    });
                    progressStarted = true;
                    isDownloading = true;
                }

                // Parse download progress - only update if progress changed
                if (line.includes('[download]') && line.includes('%')) {
                    const progressMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+([0-9.]+)MiB\s+at\s+([0-9.]+(?:\.[0-9]+)?(?:KiB|MiB))\/s(?:\s+ETA\s+([0-9:]+))?/);
                    
                    if (progressMatch) {
                        const percent = parseFloat(progressMatch[1]);
                        const speed = progressMatch[3];
                        const eta = progressMatch[4] || 'Unknown';
                        
                        // Adjust progress for multiple streams
                        const adjustedProgress = Math.round((currentStream * 100 + percent) / totalStreams);
                        
                        // Only update if progress actually changed
                        if (adjustedProgress !== lastProgress) {
                            lastProgress = adjustedProgress;
                            progressBar.update(adjustedProgress, {
                                status: totalStreams > 1 ? `Stream ${currentStream + 1}/${totalStreams}` : 'Downloading',
                                speed: speed + '/s',
                                eta: eta
                            });
                        }
                    }
                }

                // Detect when a stream completes
                if (line.includes('[download] 100%') || (line.includes('100% of') && line.includes('MiB in'))) {
                    if (currentStream < totalStreams - 1) {
                        currentStream++;
                    }
                }

                // Detect merging phase
                if (line.includes('[Merger]') || line.includes('Merging formats')) {
                    progressBar.update(95, {
                        status: 'Merging streams...',
                        speed: '',
                        eta: ''
                    });
                }

                // Detect final completion
                if (line.includes('Deleting original file')) {
                    progressBar.update(100, {
                        status: 'Complete!',
                        speed: '',
                        eta: ''
                    });
                }
            }
        });

        ytdlp.stderr.on('data', data => {
            const errorOutput = data.toString();
            if (!errorOutput.includes('WARNING') && !errorOutput.includes('[download]')) {
                console.error(errorOutput);
            }
        });

        ytdlp.on('close', code => {
            if (isDownloading) {
                progressBar.update(100, {
                    status: 'Complete!',
                    speed: '',
                    eta: ''
                });
                progressBar.stop();
            }
            code === 0 ? resolve() : reject(new Error(`Download failed with exit code ${code}`));
        });

        ytdlp.on('error', error => {
            if (isDownloading) {
                progressBar.stop();
            }
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        });
    });
}

main();