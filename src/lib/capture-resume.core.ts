/** Which state the Group B "Send my insulation details" page resumes in. Pure; facts come from the server. */
export type CaptureResume = "spot_saved" | "declared" | "choices";
export function captureResume(x: { spotSaved: boolean; ownerQualified: boolean }): CaptureResume {
  if (x.spotSaved) return "spot_saved";
  if (x.ownerQualified) return "declared";
  return "choices";
}
