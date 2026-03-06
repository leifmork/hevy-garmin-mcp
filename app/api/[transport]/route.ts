import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGarminClient } from "@/lib/garmin/client";
import { GARMIN_ENDPOINTS } from "@/lib/garmin/endpoints";
import { ActivityType } from "@flow-js/garmin-connect";
import { getHevyClient } from "@/lib/hevy/client";

export const runtime = "nodejs";

// ─── Helpers ─────────────────────────────────────────────

function formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
}

function jsonResponse(data: unknown) {
    return JSON.stringify(data, null, 2);
}

function getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

// ─── Mappers ─────────────────────────────────────────────

function mapActivitySummary(a: any) {
    return {
        activityId: a.activityId,
        name: a.activityName,
        type: a.activityType?.typeKey ?? a.activityTypeDTO?.typeKey,
        date: a.startTimeLocal,
        distanceMeters: a.distance,
        durationSeconds: a.duration,
        movingDurationSeconds: a.movingDuration,
        averageSpeedMps: a.averageSpeed,
        maxSpeedMps: a.maxSpeed,
        averageHR: a.averageHR,
        maxHR: a.maxHR,
        calories: a.calories,
        elevationGainMeters: a.elevationGain,
        elevationLossMeters: a.elevationLoss,
        averageCadence: a.averageRunningCadenceInStepsPerMinute ?? a.averageRunCadence,
        lapCount: a.lapCount ?? a.metadataDTO?.lapCount,
        vO2Max: a.vO2MaxValue,
        averageStrideLength: a.avgStrideLength,
        hasSplits: a.hasSplits ?? a.metadataDTO?.hasSplits,
    };
}

function mapActivityDetail(a: any) {
    const s = a.summaryDTO || {};
    return {
        activityId: a.activityId,
        name: a.activityName,
        type: a.activityTypeDTO?.typeKey,
        date: s.startTimeLocal,
        location: a.locationName,
        distanceMeters: s.distance,
        durationSeconds: s.duration,
        movingDurationSeconds: s.movingDuration,
        averageSpeedMps: s.averageSpeed,
        maxSpeedMps: s.maxSpeed,
        averageHR: s.averageHR,
        maxHR: s.maxHR,
        averageCadenceSpm: s.averageRunCadence,
        elevationGainMeters: s.elevationGain,
        elevationLossMeters: s.elevationLoss,
        calories: s.calories,
        trainingEffect: s.trainingEffect,
        trainingLoad: s.activityTrainingLoad,
        steps: s.steps,
        splitSummaries: a.splitSummaries,
    };
}

function mapLap(lap: any) {
    return {
        lapIndex: lap.lapIndex,
        intensityType: lap.intensityType,
        distanceMeters: lap.distance,
        durationSeconds: lap.duration,
        averageSpeedMps: lap.averageSpeed,
        averageHR: lap.averageHR,
        maxHR: lap.maxHR,
        averageCadenceSpm: lap.averageRunCadence,
        elevationGainMeters: lap.elevationGain,
        calories: lap.calories,
        complianceScore: lap.directWorkoutComplianceScore,
    };
}

function mapCalendarItem(item: any) {
    return {
        id: item.id,
        itemType: item.itemType,
        title: item.title,
        date: item.date,
        durationMs: item.duration,
        distanceMeters: item.distance,
        workoutId: item.workoutId,
    };
}

function mapWorkoutStep(step: any): any {
    if (step.type === "RepeatGroupDTO" && step.workoutSteps) {
        return {
            type: "repeat",
            stepOrder: step.stepOrder,
            numberOfIterations: step.numberOfIterations,
            steps: step.workoutSteps.map(mapWorkoutStep),
        };
    }
    return {
        stepOrder: step.stepOrder,
        stepType: step.stepType?.stepTypeKey,
        endCondition: step.endCondition?.conditionTypeKey,
        endConditionValue: step.endConditionValue,
        targetType: step.targetType?.workoutTargetTypeKey,
        targetValueOne: step.targetValueOne,
        targetValueTwo: step.targetValueTwo,
    };
}

function mapWorkoutDetail(w: any) {
    const segments = w.workoutSegments?.map((seg: any) => ({
        sportType: seg.sportType?.sportTypeKey,
        steps: seg.workoutSteps?.map(mapWorkoutStep) ?? [],
    })) ?? [];
    return {
        workoutId: w.workoutId,
        name: w.workoutName,
        sportType: w.sportType?.sportTypeKey,
        estimatedDurationSeconds: w.estimatedDurationInSecs,
        estimatedDistanceMeters: w.estimatedDistanceInMeters,
        segments,
    };
}

function mapSleepSummary(s: any) {
    const d = s.dailySleepDTO || {};
    return {
        date: d.calendarDate,
        sleepScore: d.sleepScores?.overall?.value,
        sleepScoreLabel: d.sleepScores?.overall?.qualifierKey,
        durationSeconds: d.sleepTimeSeconds,
        deepSleepSeconds: d.deepSleepSeconds,
        lightSleepSeconds: d.lightSleepSeconds,
        remSleepSeconds: d.remSleepSeconds,
        avgOvernightHrv: s.avgOvernightHrv,
        hrvStatus: s.hrvStatus,
        restingHeartRate: s.restingHeartRate,
        bodyBatteryChange: s.bodyBatteryChange,
    };
}

// ─── Tool Implementations ─────────────────────────────────

const TOOLS: Record<string, { description: string; handler: (args: any) => Promise<any> }> = {
    get_recent_activities: {
        description: "Returns recent Garmin activities. Each includes: type, distance (meters), duration (seconds), average pace (min/km), average heart rate (bpm), and calories",
        handler: async ({ limit = 10, activityType = "all" }) => {
            const client = await getGarminClient();
            const typeMap: Record<string, ActivityType | undefined> = {
                running: ActivityType.Running,
                cycling: ActivityType.Cycling,
                walking: ActivityType.Walking,
                hiking: ActivityType.Hiking,
                all: undefined,
            };
            const activities = await client.getActivities(0, limit, typeMap[activityType]);
            return activities.map(mapActivitySummary);
        },
    },
    get_activity_detail: {
        description: "Returns full detail for a single Garmin activity including per-lap splits. Distance in meters, pace in min/km, heart rate in bpm, elevation in meters",
        handler: async ({ activityId }) => {
            const client = await getGarminClient();
            const activity = await client.getActivity({ activityId });
            let laps: any[] = [];
            try {
                const splits: any = await client.get(GARMIN_ENDPOINTS.activitySplits(activityId));
                if (splits?.lapDTOs) laps = splits.lapDTOs.map(mapLap);
            } catch { }
            return { ...mapActivityDetail(activity), laps };
        },
    },
    get_planned_workout: {
        description: "Returns the Garmin Coach planned workout for a specific date including structured intervals with target pace and heart rate zones",
        handler: async ({ date = "" }) => {
            const client = await getGarminClient();
            const dateStr = date || formatDate(new Date());
            const monday = getMonday(new Date(dateStr));
            const calendarEvents = await client.getWeekCalendarEvents(monday.getFullYear(), monday.getMonth(), monday.getDate());
            const items = (calendarEvents as any)?.calendarItems || [];
            const workoutItems = items.filter((item: any) => {
                const itemDate = item.date || item.startDate || "";
                return itemDate.startsWith(dateStr) && (item.itemType === "workout" || item.workoutId || item.itemType === "WORKOUT");
            });
            const workoutDetails = [];
            for (const item of workoutItems) {
                if (item.workoutId) {
                    try {
                        const detail = await client.getWorkoutDetail({ workoutId: String(item.workoutId) });
                        workoutDetails.push(mapWorkoutDetail(detail));
                    } catch { }
                }
            }
            return { date: dateStr, calendarItems: workoutItems.map(mapCalendarItem), workoutDetails };
        },
    },
    get_planned_vs_actual: {
        description: "Compares the Garmin Coach planned workout with the actual activity performed on a given date. Shows structured plan targets alongside real splits",
        handler: async ({ date = "", activityId }) => {
            const client = await getGarminClient();
            const dateStr = date || formatDate(new Date());
            const monday = getMonday(new Date(dateStr));
            const calendarEvents = await client.getWeekCalendarEvents(monday.getFullYear(), monday.getMonth(), monday.getDate());
            const items = (calendarEvents as any)?.calendarItems || [];
            const workoutItems = items.filter((item: any) => {
                const itemDate = item.date || item.startDate || "";
                return itemDate.startsWith(dateStr) && (item.itemType === "workout" || item.workoutId);
            });
            let plannedWorkout = null;
            if (workoutItems.length > 0 && workoutItems[0].workoutId) {
                try {
                    const raw = await client.getWorkoutDetail({ workoutId: String(workoutItems[0].workoutId) });
                    plannedWorkout = mapWorkoutDetail(raw);
                } catch { }
            }
            let mappedActivity = null;
            let laps: any[] = [];
            if (activityId) {
                const raw = await client.getActivity({ activityId });
                mappedActivity = mapActivityDetail(raw);
                try {
                    const splits: any = await client.get(GARMIN_ENDPOINTS.activitySplits(activityId));
                    if (splits?.lapDTOs) laps = splits.lapDTOs.map(mapLap);
                } catch { }
            } else {
                const activities = await client.getActivities(0, 20);
                const match = activities.find((a: any) => a.startTimeLocal?.startsWith(dateStr));
                if (match) {
                    mappedActivity = mapActivitySummary(match);
                    try {
                        const splits: any = await client.get(GARMIN_ENDPOINTS.activitySplits(match.activityId));
                        if (splits?.lapDTOs) laps = splits.lapDTOs.map(mapLap);
                    } catch { }
                }
            }
            return { date: dateStr, planned: plannedWorkout, actual: mappedActivity ? { ...mappedActivity, laps } : null };
        },
    },
    get_week_summary: {
        description: "Returns all Garmin activities for a given week (Monday to Sunday). Includes per-activity distance, duration, pace, and heart rate",
        handler: async ({ date = "" }) => {
            const client = await getGarminClient();
            const dateStr = date || formatDate(new Date());
            const monday = getMonday(new Date(dateStr));
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            const calendarEvents = await client.getWeekCalendarEvents(monday.getFullYear(), monday.getMonth(), monday.getDate());
            const activities = await client.getActivities(0, 50);
            const mondayStr = formatDate(monday);
            const sundayStr = formatDate(sunday);
            const weekActivities = activities.filter((a: any) => {
                const aDate = a.startTimeLocal?.split(" ")[0] || "";
                return aDate >= mondayStr && aDate <= sundayStr;
            });
            const calItems = (calendarEvents as any)?.calendarItems || [];
            return { weekOf: mondayStr, weekEnd: sundayStr, activityCount: weekActivities.length, calendarItems: calItems.map(mapCalendarItem), activities: weekActivities.map(mapActivitySummary) };
        },
    },
    get_daily_recovery: {
        description: "Returns recovery metrics for a date: sleep duration and stages (deep/light/REM in seconds), overnight HRV, resting heart rate (bpm), and body battery change",
        handler: async ({ date = "" }) => {
            const client = await getGarminClient();
            const dateStr = date || formatDate(new Date());
            try {
                const url = `https://connectapi.garmin.com/sleep-service/sleep/dailySleepData?date=${dateStr}`;
                const sleepData = await client.get(url);
                return mapSleepSummary(sleepData);
            } catch {
                return { error: `No sleep data available for ${dateStr}.` };
            }
        },
    },
    get_weight_trend: {
        description: "Returns daily body weight (kg) and average weight for a date range",
        handler: async ({ startDate = "", endDate = "" }) => {
            const client = await getGarminClient();
            const end = endDate || formatDate(new Date());
            const startStr = startDate || (() => {
                const d = new Date(end);
                d.setDate(d.getDate() - 30);
                return formatDate(d);
            })();

            try {
                const url = `https://connectapi.garmin.com/weight-service/weight/dateRange?startDate=${startStr}&endDate=${end}`;
                const data: any = await client.get(url);
                return {
                    startDate: data.startDate,
                    endDate: data.endDate,
                    averageWeight: data.totalAverage?.weight ? (data.totalAverage.weight / 1000) : null,
                    dailyWeights: data.dateWeightList?.map((w: any) => ({
                        date: new Date(w.date).toISOString().split("T")[0],
                        weight: w.weight ? (w.weight / 1000) : null
                    })) || []
                };
            } catch {
                return { error: `Failed to fetch weight data from ${startStr} to ${end}.` };
            }
        },
    },

    get_heart_rate_zones: {
        description: "Returns the user's heart rate zone boundaries (Zone 1-5 floor/ceiling in bpm) per sport (DEFAULT, RUNNING, CYCLING, etc.), max heart rate, lactate threshold HR, VO2 max, and training method from Garmin. Call this first when analyzing heart rate data from activities to properly classify effort levels",
        handler: async () => {
            const client = await getGarminClient();
            try {
                const [zones, settings] = await Promise.all([
                    client.get(GARMIN_ENDPOINTS.heartRateZones),
                    client.get(GARMIN_ENDPOINTS.userSettings),
                ]);

                const ud = (settings as any)?.userData || {};
                const zoneList = Array.isArray(zones) ? zones : [zones];

                const sportZones = zoneList.map((z: any) => ({
                    sport: z.sport || "DEFAULT",
                    trainingMethod: z.trainingMethod,
                    maxHeartRate: z.maxHeartRateUsed,
                    restingHeartRate: z.restingHeartRateUsed,
                    lactateThresholdHeartRate: z.lactateThresholdHeartRateUsed,
                    zones: {
                        zone1: { name: "Warm Up", floorBpm: z.zone1Floor, ceilingBpm: z.zone2Floor ? z.zone2Floor - 1 : null },
                        zone2: { name: "Easy", floorBpm: z.zone2Floor, ceilingBpm: z.zone3Floor ? z.zone3Floor - 1 : null },
                        zone3: { name: "Aerobic", floorBpm: z.zone3Floor, ceilingBpm: z.zone4Floor ? z.zone4Floor - 1 : null },
                        zone4: { name: "Threshold", floorBpm: z.zone4Floor, ceilingBpm: z.zone5Floor ? z.zone5Floor - 1 : null },
                        zone5: { name: "Maximum", floorBpm: z.zone5Floor, ceilingBpm: z.maxHeartRateUsed },
                    },
                }));

                return {
                    sportZones,
                    fitnessProfile: {
                        vo2MaxRunning: ud.vo2MaxRunning,
                        vo2MaxCycling: ud.vo2MaxCycling,
                        gender: ud.gender,
                        age: ud.birthDate ? Math.floor((Date.now() - new Date(ud.birthDate).getTime()) / (365.25 * 86400000)) : null,
                    }
                };
            } catch {
                return { error: "Failed to fetch heart rate zones from Garmin." };
            }
        },
    },

    // ─── Hevy Tools ───────────────────────────────────────────

    get_lifting_sessions: {
        description: "Returns recent strength training sessions from Hevy. Supports fetching historical sessions by date range (startDate/endDate). Each includes exercises with sets, reps, weight (kg), set type (warmup/normal/failure/dropset), and RPE",
        handler: async ({ limit = 5, startDate = "", endDate = "" }) => {
            const client = getHevyClient();
            const allWorkouts: any[] = [];

            // If date range is provided, ignore limit and fetch up to 15 pages (150 workouts) to find the dates
            const maxPages = startDate ? 15 : Math.ceil(Math.min(limit, 30) / 10);

            for (let p = 1; p <= maxPages; p++) {
                const data = await client.getWorkouts(p, 10);
                const workouts = data.workouts || [];
                if (workouts.length === 0) break;

                allWorkouts.push(...workouts);

                // If the oldest workout on this page is older than our startDate, we can stop fetching
                if (startDate) {
                    const oldestOnPage = workouts[workouts.length - 1].start_time;
                    if (oldestOnPage && oldestOnPage < startDate) {
                        break;
                    }
                }
            }

            let filtered = allWorkouts;

            if (startDate || endDate) {
                filtered = allWorkouts.filter(w => {
                    const d = w.start_time;
                    if (!d) return false;
                    const isAfterStart = startDate ? d >= startDate : true;
                    // For end date, append T23:59:59 to include the whole day if they only provided YYYY-MM-DD
                    const endCompare = endDate.includes("T") ? endDate : `${endDate}T23:59:59Z`;
                    const isBeforeEnd = endDate ? d <= endCompare : true;
                    return isAfterStart && isBeforeEnd;
                });
            } else {
                filtered = allWorkouts.slice(0, limit);
            }

            return filtered.map((w: any) => ({
                id: w.id,
                title: w.title,
                description: w.description,
                startTime: w.start_time,
                endTime: w.end_time,
                durationMinutes: w.start_time && w.end_time
                    ? Math.round((new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000)
                    : null,
                exercises: (w.exercises || []).map((ex: any) => ({
                    name: ex.title,
                    templateId: ex.exercise_template_id,
                    supersetId: ex.supersets_id,
                    notes: ex.notes,
                    sets: (ex.sets || []).map((s: any) => ({
                        index: s.index,
                        type: s.type,
                        weightKg: s.weight_kg,
                        reps: s.reps,
                        rpe: s.rpe,
                    })),
                })),
            }));
        },
    },
    get_exercise_templates: {
        description: "Search Hevy exercise templates to find the template ID for a specific movement (e.g., 'Squat') to use with get_exercise_progress",
        handler: async ({ query = "", muscleGroup = "" }) => {
            const client = getHevyClient();
            let allTemplates: any[] = [];

            // Fetch all ~400 templates (usually ~5 pages of 100)
            for (let p = 1; p <= 5; p++) {
                const data = await client.getExerciseTemplates(p, 100);
                allTemplates.push(...(data.exercise_templates || []));
                if (p >= (data.page_count || 1)) break;
            }

            let results = allTemplates;

            if (query) {
                const lowerQuery = query.toLowerCase();
                results = results.filter(t => t.title.toLowerCase().includes(lowerQuery));
            }

            if (muscleGroup) {
                const lowerGroup = muscleGroup.toLowerCase();
                results = results.filter(t =>
                    t.primary_muscle_group === lowerGroup ||
                    (t.secondary_muscle_groups || []).includes(lowerGroup)
                );
            }

            return results.map(t => ({
                id: t.id,
                title: t.title,
                equipment: t.equipment,
                primaryMuscleGroup: t.primary_muscle_group,
                secondaryMuscleGroups: t.secondary_muscle_groups
            })).slice(0, 20); // Return top 20 matches to avoid giant context
        }
    },
    get_exercise_progress: {
        description: "Returns weight (kg) and rep progression history for a specific exercise, grouped by workout session over time. Use the exerciseTemplateId from get_lifting_sessions",
        handler: async ({ exerciseTemplateId, startDate, endDate }) => {
            const client = getHevyClient();
            const data = await client.getExerciseHistory(exerciseTemplateId, startDate, endDate);
            // Each entry is a single set — group them by workout
            const byWorkout: Record<string, any> = {};
            for (const entry of (data.exercise_history || [])) {
                const wId = entry.workout_id;
                if (!byWorkout[wId]) {
                    byWorkout[wId] = {
                        workoutId: wId,
                        workoutTitle: entry.workout_title,
                        date: entry.workout_start_time,
                        sets: [],
                    };
                }
                byWorkout[wId].sets.push({
                    type: entry.set_type,
                    weightKg: entry.weight_kg,
                    reps: entry.reps,
                    rpe: entry.rpe,
                });
            }
            return Object.values(byWorkout);
        },
    },
    get_lifting_routines: {
        description: "Returns all saved lifting routines/programs from Hevy with exercises, target sets, reps, rep ranges, and rest periods (seconds)",
        handler: async () => {
            const client = getHevyClient();
            const allRoutines: any[] = [];
            let page = 1;
            while (true) {
                const data = await client.getRoutines(page, 10);
                allRoutines.push(...(data.routines || []));
                if (page >= (data.page_count || 1)) break;
                page++;
            }
            return allRoutines.map((r: any) => ({
                id: r.id,
                title: r.title,
                notes: r.notes,
                folderId: r.folder_id,
                exercises: (r.exercises || []).map((ex: any) => ({
                    name: ex.title,
                    templateId: ex.exercise_template_id,
                    supersetId: ex.superset_id,
                    restSeconds: ex.rest_seconds,
                    notes: ex.notes,
                    sets: (ex.sets || []).map((s: any) => ({
                        type: s.type,
                        weightKg: s.weight_kg,
                        reps: s.reps,
                        repRange: s.rep_range,
                    })),
                })),
            }));
        },
    },
    get_lifting_volume: {
        description: "Returns total lifting volume in kg (sets × reps × weight) per exercise across recent sessions, sorted by highest volume. Warmup sets are excluded",
        handler: async ({ sessions = 5 }) => {
            const client = getHevyClient();
            const pages = Math.ceil(Math.min(sessions, 30) / 10);
            const allWorkouts: any[] = [];
            for (let p = 1; p <= pages; p++) {
                const data = await client.getWorkouts(p, 10);
                allWorkouts.push(...(data.workouts || []));
            }
            const workouts = allWorkouts.slice(0, sessions);
            const volumeByExercise: Record<string, { name: string; totalVolume: number; totalSets: number; totalReps: number; sessions: number }> = {};
            for (const w of workouts) {
                const seen = new Set<string>();
                for (const ex of (w.exercises || [])) {
                    const name = ex.title || "Unknown";
                    if (!volumeByExercise[name]) {
                        volumeByExercise[name] = { name, totalVolume: 0, totalSets: 0, totalReps: 0, sessions: 0 };
                    }
                    if (!seen.has(name)) {
                        volumeByExercise[name].sessions++;
                        seen.add(name);
                    }
                    for (const s of (ex.sets || [])) {
                        if (s.type === "warmup") continue;
                        const reps = s.reps || 0;
                        const weight = s.weight_kg || 0;
                        volumeByExercise[name].totalSets++;
                        volumeByExercise[name].totalReps += reps;
                        volumeByExercise[name].totalVolume += reps * weight;
                    }
                }
            }
            return {
                sessionCount: workouts.length,
                period: {
                    from: workouts[workouts.length - 1]?.start_time,
                    to: workouts[0]?.start_time,
                },
                exercises: Object.values(volumeByExercise).sort((a, b) => b.totalVolume - a.totalVolume),
            };
        },
    },
};

// ─── MCP Protocol Handlers ────────────────────────────────

async function handleRequest(body: any) {
    const { id, method, params } = body;

    if (method === "initialize") {
        return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fitness-mcp-server", version: "2.0.0" } } };
    }

    if (method === "tools/list") {
        const readOnlyAnnotations = {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false
        };
        const tools = [
            {
                name: "get_recent_activities",
                description: "Returns recent Garmin activities. Each includes: type, distance (meters), duration (seconds), average pace (min/km), average heart rate (bpm), and calories",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Number of activities to return (1-50, default 10)" },
                        activityType: { type: "string", description: "Filter by activity type (running, cycling, walking, hiking, all)" }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_activity_detail",
                description: "Returns full detail for a single Garmin activity including per-lap splits. Distance in meters, pace in min/km, heart rate in bpm, elevation in meters",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        activityId: { type: "number", description: "The Garmin activity ID" }
                    },
                    required: ["activityId"],
                    additionalProperties: true
                }
            },
            {
                name: "get_planned_workout",
                description: "Returns the Garmin Coach planned workout for a specific date including structured intervals with target pace and heart rate zones",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Date to check (YYYY-MM-DD). Defaults to today." }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_planned_vs_actual",
                description: "Compares the Garmin Coach planned workout with the actual activity performed on a given date. Shows structured plan targets alongside real splits",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Date to check (YYYY-MM-DD). Defaults to today." },
                        activityId: { type: "number", description: "Specific activity ID to use as 'actual'" }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_week_summary",
                description: "Returns all Garmin activities for a given week (Monday to Sunday). Includes per-activity distance, duration, pace, and heart rate",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Any date within the desired week (YYYY-MM-DD). Defaults to current week." }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_daily_recovery",
                description: "Returns recovery metrics for a date: sleep duration and stages (deep/light/REM in seconds), overnight HRV, resting heart rate (bpm), and body battery change",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Date to fetch sleep data for (YYYY-MM-DD). Defaults to today." }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_weight_trend",
                description: "Returns daily body weight (kg) and average weight for a date range",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        startDate: { type: "string", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
                        endDate: { type: "string", description: "End date (YYYY-MM-DD). Defaults to today." }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_heart_rate_zones",
                description: "Returns the user's heart rate zone boundaries (Zone 1-5 floor/ceiling in bpm) per sport (DEFAULT, RUNNING, CYCLING, etc.), max heart rate, lactate threshold HR, VO2 max, and training method from Garmin. Call this first when analyzing heart rate data from activities to properly classify effort levels",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: true
                }
            },
            // ─── Hevy Tools ───────────────────────────────────────
            {
                name: "get_lifting_sessions",
                description: "Returns recent strength training sessions from Hevy. Supports fetching historical sessions by date range (startDate/endDate). Each includes exercises with sets, reps, weight (kg), set type (warmup/normal/failure/dropset), and RPE",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Number of sessions to return (1-30, default 5). Ignored if dates are provided." },
                        startDate: { type: "string", description: "Optional start date filter (YYYY-MM-DD)." },
                        endDate: { type: "string", description: "Optional end date filter (YYYY-MM-DD)." }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_exercise_templates",
                description: "Search Hevy exercise templates to find the template ID for a specific movement (e.g., 'Squat') to use with get_exercise_progress",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search term to find in exercise title (e.g., 'Squat', 'Bench')" },
                        muscleGroup: { type: "string", description: "Optional muscle group filter (e.g., 'chest', 'quadriceps', 'biceps', 'abdominals')" }
                    },
                    additionalProperties: true
                }
            },
            {
                name: "get_exercise_progress",
                description: "Returns weight (kg) and rep progression history for a specific exercise, grouped by workout session over time. Use the exerciseTemplateId from get_lifting_sessions",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        exerciseTemplateId: { type: "string", description: "The Hevy exercise template ID (get this from get_lifting_sessions first)" },
                        startDate: { type: "string", description: "Start date filter (YYYY-MM-DD)" },
                        endDate: { type: "string", description: "End date filter (YYYY-MM-DD)" }
                    },
                    required: ["exerciseTemplateId"],
                    additionalProperties: true
                }
            },
            {
                name: "get_lifting_routines",
                description: "Returns all saved lifting routines/programs from Hevy with exercises, target sets, reps, rep ranges, and rest periods (seconds)",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: true
                }
            },
            {
                name: "get_lifting_volume",
                description: "Returns total lifting volume in kg (sets × reps × weight) per exercise across recent sessions, sorted by highest volume. Warmup sets are excluded",
                annotations: readOnlyAnnotations,
                inputSchema: {
                    type: "object",
                    properties: {
                        sessions: { type: "number", description: "Number of recent sessions to analyze (1-30, default 5)" }
                    },
                    additionalProperties: true
                }
            }
        ];
        return { jsonrpc: "2.0", id, result: { tools } };
    }

    if (method === "tools/call") {
        const { name, arguments: args } = params || {};
        const tool = TOOLS[name];
        if (!tool) {
            return { jsonrpc: "2.0", id, error: { code: -32601, message: `Tool '${name}' not found` } };
        }
        try {
            const result = await tool.handler(args || {});
            return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } };
        } catch (error: any) {
            return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true } };
        }
    }

    if (method === "notifications/initialized") {
        return null; // no response needed for notifications
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ─── Route Handlers ───────────────────────────────────────

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const response = await handleRequest(body);
        if (response === null) {
            return new NextResponse(null, { status: 204 });
        }
        // Return as SSE event for MCP client compatibility
        const data = `event: message\ndata: ${JSON.stringify(response)}\n\n`;
        return new NextResponse(data, {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        status: "Garmin AI Coach MCP Server",
        version: "1.0.0",
        tools: Object.keys(TOOLS),
    });
}
