import { Timing, Note, Track, CopyRequest, PasteRequest, Polyrhythm } from './types/general.js';
import { isSameTiming, subtractTimings, addDelta, isIntervalWithinLimits } from './utils.js';

function isPolyrhytmWithinLimits(polyrhythm: Polyrhythm, start: Timing, end: Timing): boolean {
    return isIntervalWithinLimits(polyrhythm.start.timing, polyrhythm.end.timing, start, end);
}

function isPolyrhytmNested(polyrhythm: Polyrhythm): boolean {
  return polyrhythm.start.polyrhythm !== undefined;
}

function getNestedLevel(p: Polyrhythm): number {
  const parent = p.start.polyrhythm as Polyrhythm | undefined;
  const level = parent ? getNestedLevel(parent) + 1 : 0;
  return level;
}

export class TrackClipboard {
  private track: Track;
  private buffer: Note[] = [];
  private polyrhytmsToCopy: Polyrhythm[] = [];

  constructor(track: Track) {
    this.track = track;
    return this;
  }

  get length() {
    return this.buffer.length;
  }

  copy({ start, end }: CopyRequest) {
    const notes = this.track.notes;
    let note = this.track.getNoteAt(start);
    let index = notes.indexOf(note);
    this.buffer = [];

    // copy polyrhytms 
    //     NOTE: only copied if fully within selection
    this.polyrhytmsToCopy = [];
    // Order polyrhythms from least to most nested
    //    This is to ensures that parents are checked before children in following operations
    this.track.polyrhythms.sort((a, b) => getNestedLevel(a) - getNestedLevel(b));
    this.track.polyrhythms.forEach(p => {
      if (isPolyrhytmWithinLimits(p, start, end)
        || (isPolyrhytmNested(p) && this.polyrhytmsToCopy.includes(p.start.polyrhythm)))
        this.polyrhytmsToCopy.push(p);
    });

    // copy notes
    while (true) {
      this.buffer.push(note);
      if (isSameTiming(note.timing, end))
        return; // Reached end of region to copy

      index++;
      note = notes[index];
      if (!note)
        return; // Reached end of track
    }
  }

  paste({ start, end }: PasteRequest) {
    if (end === undefined)
      end = this.track.notes[this.track.notes.length - 1].timing;
    if (this.buffer.length === 0)
      return;
    
    const notes = this.track.notes;
    let note = this.track.getNoteAt(start);
    let trackIndex = notes.indexOf(note);
    let bufferIndex = 0;
    let noteStyleToPaste = this.buffer[0].noteStyle;


    // paste notes
    while (true) {
      note.noteStyle = noteStyleToPaste;
      if (end && isSameTiming(note.timing, end))
        break;

      bufferIndex++;
      if (bufferIndex >= this.buffer.length)
        break; // Reached end of clipboard
      noteStyleToPaste = this.buffer[bufferIndex].noteStyle;

      trackIndex++;
      if (trackIndex >= notes.length)
        break; // Reached end of track
      note = notes[trackIndex];
    }

    // POLYRHYTHMS
    if (this.polyrhytmsToCopy.length === 0)
      return;
    // delete existing polyrhythms in the paste area
    let toDelete: Polyrhythm[] = [];
    this.track.polyrhythms.forEach(p => {
      if(
        (!isPolyrhytmNested(p) && isPolyrhytmWithinLimits(p, start, end))  // for first-level polys
        || (isPolyrhytmNested(p) && toDelete.includes(p.start.polyrhythm)) // for nested polys
      )
      toDelete.push(p);
    });

    toDelete.forEach(p => this.track.removePolyrhythm(p));

    // paste polyrhytms
    //    NOTE: only pasted if fully within paste area
    let copiedToPastedPolyId: Map<number, number> = new Map();
    let firstCopiedTiming = this.buffer[0].timing;
    let delta = subtractTimings(start, firstCopiedTiming);

    // we assume parents are paste before children because of ordering imposed in copy()
    this.polyrhytmsToCopy.forEach(polyrhythm => {
      if (!isPolyrhytmNested(polyrhythm)) {
        let pastedPolyStart = addDelta(polyrhythm.start.timing, delta);
        let pastedPolyEnd = addDelta(polyrhythm.end.timing, delta);
        
        if (isIntervalWithinLimits(pastedPolyStart, pastedPolyEnd, start, end)) {
          let pastedPoly = this.track.addPolyrhythm(this.track.getNoteAt(pastedPolyStart), this.track.getNoteAt(pastedPolyEnd),
            polyrhythm.notes.length, undefined, undefined, polyrhythm.notes.map(n => n.noteStyle));
          // update mapping of copied to pasted polys, that we need for nested
          if (pastedPoly != null)
            copiedToPastedPolyId.set(polyrhythm.id, pastedPoly.id);
          else
            console.log("Error: could not add polyrhythm");
        }
      } else {
        // NESTED POLY
        let originalParent = polyrhythm.start.polyrhythm;
        let pastedParent = this.track.polyrhythms.find(p => p.id == copiedToPastedPolyId.get(originalParent.id));
        if (pastedParent)
        {
          let startNote = pastedParent.notes.at(polyrhythm.start.timing.step);
          let endNote = pastedParent.notes.at(polyrhythm.end.timing.step);
          if (startNote && endNote) {
            let pastedPoly = this.track.addPolyrhythm(startNote, endNote,
              polyrhythm.notes.length, undefined, undefined, polyrhythm.notes.map(n => n.noteStyle));
            
            if (pastedPoly != null)
              copiedToPastedPolyId.set(polyrhythm.id, pastedPoly.id);
            else
              console.log("Error: could not add polyrhythm");
          }
        }
        else {
          console.log("Error: could not find parent to paste nested polyrhythm")
        }
      }
    });
  }
}
