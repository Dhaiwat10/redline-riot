export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Distance between track samples, metres. */
export const SAMPLE_SPACING = 2;
/** Half width of the paved road, metres. Two lanes each way-ish. */
export const ROAD_HALF_WIDTH = 7;
/** Gravel shoulder beyond the paint. Riding here is slower but safe. */
export const SHOULDER_WIDTH = 2.5;

export const MPS_TO_MPH = 2.23694;

export const COUNTDOWN_TICKS = 3 * TICK_RATE;
