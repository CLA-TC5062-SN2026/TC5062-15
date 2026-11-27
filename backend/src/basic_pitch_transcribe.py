"""Run the local Spotify Basic Pitch model and return note events as JSON."""

import contextlib
import json
import math
import sys

from basic_pitch.inference import predict


def main():
    if len(sys.argv) != 2:
        raise ValueError("Usage: basic_pitch_transcribe.py <audio-path>")

    audio_path = sys.argv[1]
    with contextlib.redirect_stdout(sys.stderr):
        _, _, note_events = predict(audio_path)

    notes = []
    for start, end, pitch, amplitude, _pitch_bends in note_events:
        start_time = float(start)
        end_time = float(end)
        midi_pitch = int(float(pitch))
        raw_confidence = float(amplitude)
        confidence = max(0.0, min(1.0, raw_confidence)) if math.isfinite(raw_confidence) else None
        if end_time <= start_time or not 0 <= midi_pitch <= 127:
            continue
        notes.append(
            {
                "startTimeSeconds": round(start_time, 6),
                "durationSeconds": round(end_time - start_time, 6),
                "pitchMidi": midi_pitch,
                "confidence": round(confidence, 6) if confidence is not None else None,
            }
        )

    print(json.dumps({"notes": notes}, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Basic Pitch transcription failed: {error}", file=sys.stderr)
        sys.exit(1)
