// MMM-DailyAgenda.js
Module.register("MMM-DailyAgenda", {
    // Default module config
    defaults: {
        calendars: [
            {
                url: "https://www.calendarlabs.com/ical-calendar/ics/76/US_Holidays.ics",
            },
            // Add more calendar objects here
        ],
        numberOfDays: 3, // How many days to display
        fetchInterval: 5 * 60 * 1000, // 5 minutes
        displayTimeFormat: "h:mm A", // e.g., 9:30 AM
        displayDateFormat: "dddd, MMM D", // e.g., Friday, Jul 28
        showEventCount: true,
        fadeSpeed: 1000, // How fast to fade DOM updates
		eventColors: [],
        // eventColors: ['#ff8b8b', '#87ceeb', '#90ee90', '#ffa07a', '#add8e6'], // Colors for the sidebars
        showAllDayEvents: true,
        allDayEventText: "All Day"
    },

    getScripts: function () {
        return ["moment.js"]; // Make moment available in getDom
    },

    getStyles: function () {
        return ["MMM-DailyAgenda.css", "font-awesome.css"]; // Include Font Awesome if using symbols
    },

    start: function () {
        Log.info("Starting module: " + this.name);
        this.allEvents = []; // Store events from all calendars
        this.loaded = false;
        this.error = null;

        // Send config to node_helper right away
        this.sendSocketNotification("CONFIG", this.config);

        // Schedule the first update after a short delay to allow node_helper to start
        // setTimeout(() => {
        //     this.sendSocketNotification("FETCH_CALENDARS"); // Initial fetch trigger
        // }, 1000); // No longer needed as fetch happens on CONFIG receipt

    },

	// re-call calendar if resuming (helps with pages)
	resume: function() {
		this.sendSocketNotification("CONFIG", this.config);
	},

    socketNotificationReceived: function (notification, payload) {
        if (notification === "EVENTS_RECEIVED") {
            // Filter out duplicates if the same event exists in multiple calendars (basic check)
            const uniquePayload = payload.filter(newEvent =>
                !this.allEvents.some(existingEvent =>
                    existingEvent.title === newEvent.title &&
                    existingEvent.startDate === newEvent.startDate &&
                    existingEvent.endDate === newEvent.endDate
                )
            );

            // Append new unique events and re-sort
            this.allEvents = [...this.allEvents, ...uniquePayload];
            this.allEvents.sort((a, b) => moment(a.startDate).diff(moment(b.startDate)));

            this.loaded = true;
            this.error = null; // Clear previous errors on success
            this.updateDom(this.config.fadeSpeed);
        } else if (notification === "CALENDAR_ERROR") {
            Log.error("Calendar Error for URL:", payload.url, payload.error);
            // You could display this error in the DOM if needed
            this.error = `Error fetching ${payload.url}`;
            this.loaded = true; // Still allow DOM update to show error
            this.updateDom();
        }
    },

    getDom: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "daily-agenda-wrapper";

        if (!this.loaded) {
            wrapper.innerHTML = this.translate("LOADING");
            wrapper.className = "dimmed light small";
            return wrapper;
        }

        if (this.error) {
            wrapper.innerHTML = "Error: " + this.error;
            wrapper.className = "dimmed light small alert";
            return wrapper;
        }

        const today = moment().startOf('day');
		const now = moment();
        let colorIndex = 0; // Cycle through colors

        for (let i = 0; i < this.config.numberOfDays; i++) {
            const currentDay = moment(today).add(i, 'days');
			console.log(this.allEvents);
			const eventsForDay = this.allEvents.filter(event => {
                const eventStart = moment(event.startDate);
                const eventEnd = moment(event.endDate);
                const dayStart = moment(currentDay).startOf('day'); // Start of the day we are checking
                const dayEnd = moment(currentDay).endOf('day');     // End of the day we are checking

                if (event.allDay) {
                    // --- All-Day Event Logic ---
                    // For all-day events, the iCal standard means the 'end' date/time is exclusive.
                    // An event for May 12th ends *at* the start of May 13th (e.g., 2025-05-13T00:00:00).
                    // An event for May 1st-2nd ends *at* the start of May 3rd (e.g., 2025-05-03T00:00:00).

                    // We need to check if the 'currentDay' we are displaying falls within the event's date range.
                    // The event starts on eventStart's date.
                    // The event effectively ends just before the eventEnd date begins.

                    // Use moment's isSameOrAfter and isBefore with 'day' granularity.
                    const isCurrentDayOnOrAfterStartDay = currentDay.isSameOrAfter(eventStart, 'day');

                    // Check if the current day is strictly *before* the event's end day.
                    // This correctly handles the exclusive nature of the end date.
                    const isCurrentDayBeforeEndDay = currentDay.isBefore(eventEnd, 'day');

                    return isCurrentDayOnOrAfterStartDay && isCurrentDayBeforeEndDay;

                } else {
                    // --- Timed Event Logic (Original Overlap Check) ---
                    // Check if the event interval [eventStart, eventEnd) overlaps with [dayStart, dayEnd]
                    const startsBeforeDayEnds = eventStart.isBefore(dayEnd); // Use isBefore for strict end
                    const endsAfterDayStarts = eventEnd.isAfter(dayStart);   // Use isAfter for strict start
                    return startsBeforeDayEnds && endsAfterDayStarts;
                }
            });


            // Only create a day section if there are events OR if you always want to show the day header
            // if (eventsForDay.length > 0) {
                const dayContainer = document.createElement("div");
                dayContainer.className = "day-container";

                const dayHeader = document.createElement("div");
                dayHeader.className = "day-header";
                dayHeader.innerHTML = currentDay.format(this.config.displayDateFormat);
                dayContainer.appendChild(dayHeader);

                if (this.config.showEventCount && eventsForDay.length > 0) {
                    const eventCount = document.createElement("div");
                    eventCount.className = "event-count dimmed small";
                    eventCount.innerHTML = `${eventsForDay.length} event${eventsForDay.length === 1 ? '' : 's'}`;
                    dayContainer.appendChild(eventCount);
                }
                 if (eventsForDay.length === 0) {
                    const noEvents = document.createElement("div");
                    noEvents.className = "no-events dimmed light small";
                    noEvents.innerHTML = "No events scheduled.";
                    dayContainer.appendChild(noEvents);
                 } else {
                    eventsForDay.forEach(event => {
                         if (!this.config.showAllDayEvents && event.allDay) {
                            return; // Skip if configured to hide all-day events
                         }

                        const eventItem = document.createElement("div");
                        eventItem.className = "event-item";

						const eventEnd = moment(event.endDate);
						if (eventEnd.isBefore(now)) { // Check if event end time is before now
							eventItem.classList.add("event-over"); // Add the class if it's over
						}

						if (event.color) {
							const colorBar = document.createElement("div");
							colorBar.className = "event-color-bar";
							colorBar.style.backgroundColor = event.color;
							eventItem.appendChild(colorBar);
						}

                        const eventDetails = document.createElement("div");
                        eventDetails.className = "event-details";

                        const eventTitle = document.createElement("div");
                        eventTitle.className = "event-title bright";
                        eventTitle.innerHTML = event.title;
                        eventDetails.appendChild(eventTitle);

                        const eventTime = document.createElement("div");
                        eventTime.className = "event-time dimmed small";
                        if (event.allDay) {
                             eventTime.innerHTML = this.config.allDayEventText;
                        } else {
                            const startTime = moment(event.startDate).format(this.config.displayTimeFormat);
                            const endTime = moment(event.endDate).format(this.config.displayTimeFormat);
                             // Avoid showing end time if it's same as start (e.g., from Google Calendar invites)
                             if (moment(event.startDate).isSame(moment(event.endDate))) {
                                 eventTime.innerHTML = startTime;
                             } else {
                                eventTime.innerHTML = `${startTime} - ${endTime}`;
                            }
                        }
                        eventDetails.appendChild(eventTime);

                        eventItem.appendChild(eventDetails);
                        dayContainer.appendChild(eventItem);

                        colorIndex++; // Move to next color
                    });
                 }

                wrapper.appendChild(dayContainer);
            // } // End if eventsForDay.length > 0
        }

         if (wrapper.children.length === 0 && this.allEvents.length === 0) {
             wrapper.innerHTML = "No upcoming events found.";
            wrapper.className = "dimmed light small";
         }

        return wrapper;
    }
});
