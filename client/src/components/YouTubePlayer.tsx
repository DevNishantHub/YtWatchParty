import { useEffect, useRef } from "react";
import type { PlayState } from "../types";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiPromise;
}

interface Props {
  playState: PlayState;
  canControl: boolean;
  onLocalPlay: () => void;
  onLocalPause: () => void;
  onLocalSeek: (time: number) => void;
}

/**
 * Renders the YouTube IFrame player and keeps it in sync with the
 * room's authoritative playState. Local user actions (when allowed)
 * are forwarded up via the on* callbacks rather than mutating local
 * state directly, since the server is the source of truth.
 */
export default function YouTubePlayer({
  playState,
  canControl,
  onLocalPlay,
  onLocalPause,
  onLocalSeek,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const lastVideoIdRef = useRef<string | null>(null);

  // Refs mirroring the latest props, so callbacks created once inside the
  // YT.Player constructor (onReady/onStateChange) never see stale values.
  const canControlRef = useRef(canControl);
  const playStateRef = useRef(playState);
  useEffect(() => {
    canControlRef.current = canControl;
  }, [canControl]);
  useEffect(() => {
    playStateRef.current = playState;
  }, [playState]);

  // Applies a given server playState to the actual player. Shared by the
  // "state changed" effect below AND by onReady, so a player that becomes
  // ready late (slow network) still ends up at the right position instead
  // of sitting at 0:00 until the next broadcast.
  const applyRemoteState = (state: PlayState) => {
    const player = playerRef.current;
    if (!player || !readyRef.current || !state.videoId) return;

    applyingRemoteRef.current = true;

    if (state.videoId !== lastVideoIdRef.current) {
      lastVideoIdRef.current = state.videoId;
      player.loadVideoById(state.videoId, Math.max(0, state.currentTime));
      if (!state.isPlaying) {
        // loadVideoById always starts playing; pause immediately after cueing.
        setTimeout(() => player.pauseVideo?.(), 400);
      }
    } else {
      const current = player.getCurrentTime?.() ?? 0;
      if (Math.abs(current - state.currentTime) > 1.5) {
        player.seekTo(state.currentTime, true);
      }
      if (state.isPlaying) player.playVideo?.();
      else player.pauseVideo?.();
    }

    setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 500);
  };

  // Initialize player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: "100%",
        width: "100%",
        videoId: playStateRef.current.videoId || undefined,
        playerVars: { autoplay: 0, controls: 1, rel: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            if (playStateRef.current.videoId) {
              lastVideoIdRef.current = null; // force applyRemoteState to (re)position it
              applyRemoteState(playStateRef.current);
            }
          },
          onStateChange: (e: any) => {
            if (applyingRemoteRef.current) return; // ignore programmatic changes we made
            if (!canControlRef.current) return; // viewers can't drive sync

            const YT = window.YT;
            const player = playerRef.current;
            const time = player?.getCurrentTime?.() ?? 0;

            // A native scrub (dragging YouTube's own progress bar) doesn't
            // fire a dedicated "seek" event — it just lands on PLAYING or
            // PAUSED at a new time. So on every local play/pause transition
            // we broadcast the seek position too. This makes manual timeline
            // drags sync correctly, not just our own play/pause buttons.
            if (e.data === YT.PlayerState.PLAYING) {
              onLocalSeek(time);
              onLocalPlay();
            } else if (e.data === YT.PlayerState.PAUSED) {
              onLocalSeek(time);
              onLocalPause();
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply remote (server) state changes to the player whenever they arrive.
  useEffect(() => {
    applyRemoteState(playState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playState.videoId, playState.isPlaying, playState.currentTime, playState.lastUpdated]);

  const handleSeekClick = () => {
    const player = playerRef.current;
    if (!player || !canControl) return;
    const time = player.getCurrentTime?.() ?? 0;
    onLocalSeek(time);
  };

  return (
    <div className="player-wrap">
      <div ref={containerRef} className="player-frame" />
      {canControl && (
        <button
          className="seek-sync-btn"
          onClick={handleSeekClick}
          title="Manually re-sync everyone to your current playback position (useful during long uninterrupted playback, since drift isn't corrected continuously)"
        >
          Sync seek position to room
        </button>
      )}
    </div>
  );
}
