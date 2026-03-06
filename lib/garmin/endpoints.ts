/**
 * Custom Garmin Connect API endpoints not exposed by @flow-js/garmin-connect.
 * Centralized here so if Garmin changes URLs, there's one place to update.
 *
 * Base URL matches the library's GC_API: https://connectapi.garmin.com
 */

const GC_API = "https://connectapi.garmin.com";

export const GARMIN_ENDPOINTS = {
  /** Per-lap splits for an activity */
  activitySplits: (activityId: number) =>
    `${GC_API}/activity-service/activity/${activityId}/splits`,

  /** Detailed activity data (includes HR zones, etc.) */
  activityDetails: (activityId: number) =>
    `${GC_API}/activity-service/activity/${activityId}/details`,

  /** HRV daily status for recovery signals */
  hrvStatus: (dateString: string) =>
    `${GC_API}/hrv-service/hrv/${dateString}`,

  /** Scheduled workouts for a specific date range */
  calendarItems: (startDate: string, endDate: string) =>
    `${GC_API}/calendar-service/year/${startDate}/${endDate}`,

  /** Heart rate zone boundaries (Zone 1-5 floors, max HR, lactate threshold) */
  heartRateZones: `${GC_API}/biometric-service/heartRateZones`,

  /** User profile settings (VO2 max, lactate threshold HR, weight, height, etc.) */
  userSettings: `${GC_API}/userprofile-service/userprofile/user-settings`,
} as const;
