import { Download, Film, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { formatFileSize } from "../../../lib/format";
import { useVideoPlayback } from "../hooks/use-video-playback";
import type { Attachment } from "../types";

export function VideoAttachment({ file }: { file: Attachment }) {
  const playback = useVideoPlayback();

  return (
    <div className="video-attachment">
      <div className="video-frame" ref={playback.frameRef}>
        <video
          ref={playback.videoRef}
          src={playback.active ? (file.playback_url ?? undefined) : undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={`Video: ${file.original_filename}`}
          hidden={playback.failed}
          onPlay={playback.onPlay}
          onPlaying={playback.onPlaying}
          onWaiting={playback.onWaiting}
          onPause={playback.onPause}
          onError={playback.onError}
        />
        {!playback.started && !playback.failed && (
          <button
            className="video-play-button"
            aria-label={`Play ${file.original_filename}`}
            onClick={() => void playback.play()}
          >
            <Play size={26} fill="currentColor" />
          </button>
        )}
        {playback.buffering && playback.started && !playback.failed && (
          <div className="video-buffering" role="status" aria-label="Buffering video">
            <LoaderCircle className="animate-spin" size={27} />
          </div>
        )}
        {playback.failed && (
          <div className="video-error" role="status">
            <Film size={26} />
            <span>This video couldn’t play in your browser.</span>
            <small>Try again or download the original.</small>
            <button onClick={() => void playback.play(true)}>
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        )}
      </div>
      <div className="video-caption">
        <span>
          <strong title={file.original_filename}>{file.original_filename}</strong>
          <small>{formatFileSize(file.size)}</small>
        </span>
        <a
          className="icon-button"
          href={file.download_url}
          download={file.original_filename}
          aria-label={`Download ${file.original_filename}`}
          title="Download original"
        >
          <Download size={17} />
        </a>
      </div>
    </div>
  );
}
