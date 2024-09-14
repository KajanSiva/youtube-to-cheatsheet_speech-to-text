const youtubeDl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');

// const youtubeUrl = 'https://youtu.be/GlTA4wXSACE?si=fuAe_5cHnA2hRE0a';
const youtubeUrl = 'https://youtu.be/CKTY0fwYxHY?si=kqAbKkJn4Xd_b0D_';

async function downloadAudio(url) {
    try {
        const output = await youtubeDl(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:googlebot'
            ]
        });

        const outputFolder = 'output/audio';

        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }

        const title = output.title.replace(/[^\w\s]/gi, '');
        const outputFilename = path.join(outputFolder, `${title}.webm`);
        console.log(`Downloading: ${outputFilename}`);

        await youtubeDl(url, {
            output: outputFilename,
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '64K',
            postprocessorArgs: [
                // Set audio sample rate to 16kHz
                '-ar', '16000',
                // Set to mono channel
                '-ac', '1',
                // Set bitrate to 64k
                '-b:a', '64k'
            ]
        });

        console.log('Download completed!');
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

downloadAudio(youtubeUrl);
