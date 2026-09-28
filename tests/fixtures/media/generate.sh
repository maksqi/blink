#!/bin/sh
# Generates the reference and malicious media fixtures for tests/api/recordings with ffmpeg's lavfi sources, so no
# binary media is committed. Usage: sh tests/fixtures/media/generate.sh <output-dir>   (FFMPEG_PATH overrides ffmpeg)
#
# Reference inputs (3 s, 320x240 test pattern, 440 Hz tone):
#   vp9-opus.webm, vp8-opus.webm    streamed WebM without cues or duration, like MediaRecorder output
#   h264-aac.mp4, h264-opus.mp4     fragmented MP4 (moov first), like MediaRecorder output
#   extras.mkv                       Matroska with title/comment tags, two chapters and a SubRip subtitle stream
#   extras.mov                       fragmented QuickTime with tags, chapters, mov_text subtitles and a tmcd data track
# Malicious inputs:
#   huge.webm                        one 8192x8192 VP8 frame
#   audio-only.webm                  Opus only
#   mjpeg.mkv                        Motion JPEG video (not allowlisted)
#   playlist.m3u8                    HLS playlist pointing at a URL
#   list.ffconcat                    ffconcat script pointing at a local file
set -eu

out=${1:?usage: generate.sh <output-dir>}
mkdir -p "$out"
ff="${FFMPEG_PATH:-ffmpeg}"

video="testsrc2=size=320x240:rate=30:duration=3"
tone="sine=frequency=440:sample_rate=48000:duration=3"

run() {
  "$ff" -nostdin -hide_banner -loglevel error -y "$@"
}

# Streamed WebM: written to a pipe, so the muxer cannot seek back to add cues or a duration.
run -f lavfi -i "$video" -f lavfi -i "$tone" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 300k \
  -c:a libopus -b:a 64k -f webm pipe:1 > "$out/vp9-opus.webm"
run -f lavfi -i "$video" -f lavfi -i "$tone" -c:v libvpx -deadline realtime -cpu-used 8 -b:v 300k \
  -c:a libopus -b:a 64k -f webm pipe:1 > "$out/vp8-opus.webm"

frag="frag_keyframe+empty_moov+default_base_moof"
run -f lavfi -i "$video" -f lavfi -i "$tone" -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags "$frag" -f mp4 "$out/h264-aac.mp4"
run -f lavfi -i "$video" -f lavfi -i "$tone" -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a libopus -b:a 64k -movflags "$frag" -f mp4 "$out/h264-opus.mp4"

printf ';FFMETADATA1\ntitle=blinq-fixture-title\ncomment=blinq-fixture-comment\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Chapter one\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3000\ntitle=Chapter two\n' > "$out/metadata.txt"
printf '1\n00:00:00,000 --> 00:00:02,000\nblinq fixture subtitle\n\n' > "$out/subtitles.srt"
run -f lavfi -i "$video" -f lavfi -i "$tone" -i "$out/metadata.txt" -i "$out/subtitles.srt" \
  -map 0:v -map 1:a -map 3:s -map_metadata 2 -map_chapters 2 \
  -c:v libvpx -deadline realtime -cpu-used 8 -b:v 300k -c:a libopus -b:a 64k -c:s srt -f matroska "$out/extras.mkv"
run -f lavfi -i "$video" -f lavfi -i "$tone" -i "$out/metadata.txt" -i "$out/subtitles.srt" \
  -map 0:v -map 1:a -map 3:s -map_metadata 2 -map_chapters 2 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -c:s mov_text -timecode 01:00:00:00 -write_tmcd 1 \
  -movflags "$frag" -f mov "$out/extras.mov"
rm -f "$out/metadata.txt" "$out/subtitles.srt"

run -f lavfi -i "color=c=gray:size=8192x8192:rate=1:duration=1" -frames:v 1 \
  -c:v libvpx -deadline realtime -cpu-used 8 -b:v 100k -f webm "$out/huge.webm"
run -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" -c:a libopus -b:a 64k -f webm "$out/audio-only.webm"
run -f lavfi -i "testsrc2=size=160x120:rate=10:duration=1" -c:v mjpeg -f matroska "$out/mjpeg.mkv"
printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nhttp://127.0.0.1:9/blinq-fixture.ts\n#EXT-X-ENDLIST\n' > "$out/playlist.m3u8"
printf "ffconcat version 1.0\nfile '/etc/passwd'\n" > "$out/list.ffconcat"

touch "$out/.complete"
