const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const { text } = require('stream/consumers');
require('dotenv').config();

const openai = new OpenAI();
const MAX_CHUNK_SIZE = 23 * 1024 * 1024; // 23MB in bytes

const audioFilePath = "./output/audio/Il a lanc 40 STARTUPS dont 3 licornes  ft Thibaud Elzire.webm";

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

function splitAudio(filePath, maxChunkSize = MAX_CHUNK_SIZE, minSilenceLen = 0.5, silenceThresh = -40) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let currentChunk = [0];
    let lastSilenceEnd = 0;

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const duration = metadata.format.duration;
      const bitrate = metadata.format.bit_rate;
      const targetChunkDuration = (maxChunkSize * 8) / bitrate;

      ffmpeg(filePath)
        .audioFilters(`silencedetect=noise=${silenceThresh}dB:d=${minSilenceLen}`)
        .format('null')
        .on('stderr', line => {
          const silenceEnd = line.match(/silence_end: (\d+\.\d+)/);
          const silenceStart = line.match(/silence_start: (\d+\.\d+)/);

          if (silenceEnd) {
            const end = parseFloat(silenceEnd[1]);
            if (end - lastSilenceEnd >= targetChunkDuration) {
              currentChunk.push(end);
              chunks.push(currentChunk);
              currentChunk = [end];
              lastSilenceEnd = end;
            }
          } else if (silenceStart) {
            const start = parseFloat(silenceStart[1]);
            if (start - lastSilenceEnd >= targetChunkDuration) {
              currentChunk.push(start);
              chunks.push(currentChunk);
              currentChunk = [start];
              lastSilenceEnd = start;
            }
          }
        })
        .on('end', () => {
          if (currentChunk.length > 1) {
            chunks.push(currentChunk);
          }
          if (chunks[chunks.length - 1][1] < duration) {
            chunks.push([chunks[chunks.length - 1][1], duration]);
          }
          resolve(chunks);
        })
        .on('error', reject)
        .output('/dev/null')
        .run();
    });
  });
}

async function transcribeChunk(filePath, start, end, chunkNumber) {
  try {
    const chunkPath = `temp_chunk_${chunkNumber}.mp3`;
    console.log(`Processing chunk ${chunkNumber}: ${start.toFixed(2)} - ${end.toFixed(2)}`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .setStartTime(start)
        .setDuration(end - start)
        .output(chunkPath)
        .outputFormat('mp3')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  
    const chunkSize = getFileSizeInBytes(chunkPath);
    console.log(`Chunk ${chunkNumber} size: ${(chunkSize / 1024 / 1024).toFixed(2)} MB`);
  

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(chunkPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"]
    });
  
    fs.unlinkSync(chunkPath);
    console.log(`Chunk ${chunkNumber} transcribed successfully`);
    return {
      text: transcript.text,
      segments: transcript.segments.map(segment => ({
        id: segment.id,
        seek: segment.seek,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        tokens: segment.tokens,
      }))
    }
  } catch (error) {
    console.error(`Error transcribing chunk ${chunkNumber}:`, error.message);
    throw error;
  }
}

async function generateTranscript(filePath) {
  const chunks = await splitAudio(filePath);
  const transcripts = {
    text: '',
    segments: []
  };
  const outputFolder = 'output/transcript_chunks';

  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  for (let i = 0; i < chunks.length; i++) {
    const [start, end] = chunks[i];
    const transcript = await transcribeChunk(filePath, start, end, i);
    transcripts.text += transcript.text;
    const segmentOffset = transcripts.segments.length;
    const timeOffset = start;
    transcripts.segments.push(...transcript.segments.map(segment => ({
      ...segment,
      id: segment.id + segmentOffset,
      seek: segment.seek + segmentOffset,
      start: segment.start + timeOffset,
      end: segment.end + timeOffset
    })));
  }

  return transcripts;
}

async function main() {
  console.log("Starting transcription process...");
  const fullTranscript = await generateTranscript(audioFilePath);

  const outputFolder = 'output/transcript';
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }
  
  const fileName = path.basename(audioFilePath, path.extname(audioFilePath));
  const outputFilePath = path.join(outputFolder, `${fileName}.json`);

  fs.writeFileSync(outputFilePath, JSON.stringify(fullTranscript, null, 2));
  console.log(`Transcription complete. Full transcript saved in '${outputFilePath}'`);
}

main().catch(console.error);