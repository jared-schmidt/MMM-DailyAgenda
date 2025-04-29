// node_helper.js
const NodeHelper = require("node_helper");
const ical = require("node-ical");
const moment = require("moment"); // Use moment for easier date comparison

module.exports = NodeHelper.create({
    start: function () {
        console.log("Starting node helper for: " + this.name);
        this.fetchers = [];
        this.config = {}; // Initialize config object
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "CONFIG") {
            this.config = payload;
            // Clear existing fetchers if config changes
            this.clearFetchers();
            // Create fetchers for the new config
            this.createFetchers();
        }
    },

    // Create fetchers for each calendar URL
    createFetchers: function () {
        // Ensure config and calendars are defined
        if (!this.config || !this.config.calendars) {
            console.error(this.name + ": Config or calendars not defined yet.");
            return;
        }
        this.config.calendars.forEach(calendar => {
            console.log("Creating fetcher for url: " + calendar.url + " - Interval: " + (this.config.fetchInterval / 1000) + " seconds");
            this.fetchCalendar(calendar.url, calendar.color); // Fetch immediately on setup
            // Set up interval fetching
            const fetcher = setInterval(() => {
                this.fetchCalendar(calendar.url, calendar.color);
            }, this.config.fetchInterval);
            // Store fetcher interval ID to clear later if needed
            this.fetchers.push(fetcher);
        });
    },

    // Clear existing fetcher intervals
    clearFetchers: function () {
        this.fetchers.forEach(fetcher => clearInterval(fetcher));
        this.fetchers = [];
    },

    // Fetch and process calendar data
    fetchCalendar: function (url, color) {
        console.log(this.name + ": Fetching calendar: " + url); // Added log
        ical.fromURL(url, {}, (err, data) => {
            if (err) {
                console.error(this.name + ": Error fetching calendar " + url + ":", err.message); // Log error message
                this.sendSocketNotification("CALENDAR_ERROR", { url: url, error: err.message });
                return;
            }

            if (!data) {
                 console.error(this.name + ": No data received from calendar " + url);
                 this.sendSocketNotification("CALENDAR_ERROR", { url: url, error: "No data received" });
                 return;
            }

            const events = this.processEvents(data);
            // Add calendar symbol/identifier if needed later for styling/filtering
            events.forEach(event => {
                event.sourceCalendarUrl = url;
                event.color = color;
            });

            console.log(this.name + ": Fetched " + events.length + " valid events from " + url);
            this.sendSocketNotification("EVENTS_RECEIVED", events);
        });
    },

    // Process raw ical data into a usable format
    processEvents: function (data) {
        const events = [];
        // Ensure config is available before proceeding
        if (!this.config || typeof this.config.numberOfDays === 'undefined') {
             console.error(this.name + ": Config not available in processEvents.");
             return events; // Return empty array if config isn't ready
        }

        const today = moment().startOf('day');
        // Define the range for fetching events
        const rangeStart = moment(today); // Start from today
        const rangeEnd = moment(today).add(this.config.numberOfDays, 'days').endOf('day'); // Limit to configured days

        for (const k in data) {
            if (data.hasOwnProperty(k)) {
                const event = data[k];
                if (event.type === 'VEVENT') {
                    let originalStartDate = moment(event.start);
                    let originalEndDate = moment(event.end);
                    let durationMs = originalEndDate.diff(originalStartDate); // Calculate duration

                    // Basic check for valid end date
                    if (!originalEndDate.isValid() || originalEndDate.isBefore(originalStartDate)) {
                        originalEndDate = moment(originalStartDate); // Treat as point-in-time or single day if no valid end
                        durationMs = 0; // Reset duration if end date was invalid
                    }

                    // --- RECURRENCE HANDLING ---
                    if (event.rrule) {
                        const rule = event.rrule;
                        let dates = [];

                        // Use rule.between to get occurrences within the desired range
                        try {
                            dates = rule.between(rangeStart.toDate(), rangeEnd.toDate(), true);
                        } catch (e) {
                            console.error(this.name + ": Error processing rrule for event '" + (event.summary || 'No Title') + "':", e.message);
                            continue; // Skip this event if rrule processing fails
                        }


                        // Handle exceptions (exdate)
                        if (event.exdate) {
                            const exdates = Object.keys(event.exdate).map(key => moment(event.exdate[key]));
                            dates = dates.filter(date => {
                                return !exdates.some(exdate => moment(date).isSame(exdate, 'day')); // Compare day only for simplicity
                            });
                        }

                        // Create an event instance for each valid occurrence date
                        dates.forEach(date => {
                            const occurrenceStart = moment(date);
                            // Ensure start time matches original event's time if not all-day
                            if (!this.isFullDayEvent(event)) {
                                occurrenceStart.set({
                                    hour: originalStartDate.hour(),
                                    minute: originalStartDate.minute(),
                                    second: originalStartDate.second()
                                });
                            }
                            const occurrenceEnd = moment(occurrenceStart).add(durationMs, 'milliseconds');

                            // Double-check if the occurrence *actually* falls within our display window
                            // (rrule.between might include events starting just before the range but ending within it)
                            if (occurrenceStart.isBefore(rangeEnd) && occurrenceEnd.isAfter(rangeStart)) {
                                events.push({
                                    title: event.summary || 'No Title',
                                    startDate: occurrenceStart.toISOString(),
                                    endDate: occurrenceEnd.toISOString(),
                                    allDay: this.isFullDayEvent(event),
                                    location: event.location || null,
                                    description: event.description || null,
                                    // raw: event // Optional: include raw event for debugging
                                });
                            }
                        });

                    } else {
                        // --- SINGLE EVENT HANDLING ---
                        // Filter events outside the desired range
                        if (originalStartDate.isBefore(rangeEnd) && originalEndDate.isAfter(rangeStart)) {
                            events.push({
                                title: event.summary || 'No Title',
                                startDate: originalStartDate.toISOString(),
                                endDate: originalEndDate.toISOString(),
                                allDay: this.isFullDayEvent(event),
                                location: event.location || null,
                                description: event.description || null,
                                // raw: event // Optional: include raw event for debugging
                            });
                        }
                    }
                }
            }
        }

        // Sort events by start date
        events.sort((a, b) => moment(a.startDate).diff(moment(b.startDate)));
        return events;
    },

    // Helper function to determine if an event is all-day
    // (Based on logic from default calendar utils)
    isFullDayEvent: function (event) {
        if (event.start.length === 8 || event.start.dateOnly || event.datetype === 'date') {
            return true;
        }

        const start = moment(event.start);
        const end = moment(event.end);

        // Check if duration is a multiple of 24 hours and starts at midnight
        return (end.diff(start, 'hours') % 24 === 0 &&
                start.hour() === 0 &&
                start.minute() === 0 &&
                start.second() === 0);
    }
});
