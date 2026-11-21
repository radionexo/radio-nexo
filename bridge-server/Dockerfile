FROM node:18-alpine

# Install native FFmpeg for ultra-low-latency MP3 CBR transcoding
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV PORT=8000
EXPOSE 8000

CMD ["node", "index.js"]
