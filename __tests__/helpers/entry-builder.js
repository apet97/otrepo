/**
 * EntryBuilder - Fluent API for creating test time entries
 *
 * Usage:
 *   new EntryBuilder()
 *     .withUser('user1', 'Alice')
 *     .withDuration(10)
 *     .asBreak()
 *     .nonBillable()
 *     .build()
 */
export class EntryBuilder {
  constructor() {
    if (!EntryBuilder._counter) {
      EntryBuilder._counter = 0;
    }
    EntryBuilder._counter += 1;
    this._id = `entry_${EntryBuilder._counter}`;
    this._userId = 'user1';
    this._userName = 'TestUser';
    this._startTime = '2025-01-15T09:00:00Z';
    this._durationHours = 8;
    this._hourlyRate = 5000; // cents
    this._billable = true;
    this._type = 'REGULAR';
    this._description = '';
    this._projectId = null;
    this._projectName = null;
    this._clientId = null;
    this._clientName = null;
    this._taskId = null;
    this._taskName = null;
    this._tags = [];
    this._costRate = null;
  }

  /**
   * Set entry ID
   */
  withId(id) {
    this._id = id;
    return this;
  }

  /**
   * Set user info
   */
  withUser(userId, userName = 'TestUser') {
    this._userId = userId;
    this._userName = userName;
    return this;
  }

  /**
   * Set start time (ISO string or Date)
   */
  startingAt(startTime) {
    if (startTime instanceof Date) {
      this._startTime = startTime.toISOString();
    } else {
      this._startTime = startTime;
    }
    return this;
  }

  /**
   * Set date using YYYY-MM-DD format (defaults to 9am UTC)
   */
  onDate(dateString, hour = 9) {
    this._startTime = `${dateString}T${hour.toString().padStart(2, '0')}:00:00Z`;
    return this;
  }

  /**
   * Set duration in hours
   */
  withDuration(hours) {
    this._durationHours = hours;
    return this;
  }

  /**
   * Set hourly rate in cents
   */
  withRate(rateInCents) {
    this._hourlyRate = rateInCents;
    return this;
  }

  /**
   * Set hourly rate in dollars (convenience)
   */
  withRateDollars(rateDollars) {
    this._hourlyRate = rateDollars * 100;
    return this;
  }

  /**
   * Set cost rate in cents
   */
  withCostRate(rateInCents) {
    this._costRate = rateInCents;
    return this;
  }

  /**
   * Mark as billable
   */
  billable() {
    this._billable = true;
    return this;
  }

  /**
   * Mark as non-billable
   */
  nonBillable() {
    this._billable = false;
    return this;
  }

  /**
   * Set entry type to BREAK
   */
  asBreak() {
    this._type = 'BREAK';
    return this;
  }

  /**
   * Set entry type to TIME_OFF
   */
  asTimeOff() {
    this._type = 'TIME_OFF';
    return this;
  }

  /**
   * Set entry type to HOLIDAY
   */
  asHoliday() {
    this._type = 'HOLIDAY';
    return this;
  }

  /**
   * Set entry type to REGULAR
   */
  asRegular() {
    this._type = 'REGULAR';
    return this;
  }

  /**
   * Set custom entry type
   */
  withType(type) {
    this._type = type;
    return this;
  }

  /**
   * Set description
   */
  withDescription(description) {
    this._description = description;
    return this;
  }

  /**
   * Set project info
   */
  withProject(projectId, projectName = 'Test Project') {
    this._projectId = projectId;
    this._projectName = projectName;
    return this;
  }

  /**
   * Set client info
   */
  withClient(clientId, clientName = 'Test Client') {
    this._clientId = clientId;
    this._clientName = clientName;
    return this;
  }

  /**
   * Set task info
   */
  withTask(taskId, taskName = 'Test Task') {
    this._taskId = taskId;
    this._taskName = taskName;
    return this;
  }

  /**
   * Add tags
   */
  withTags(...tags) {
    this._tags = tags;
    return this;
  }

  /**
   * Build the entry object
   */
  build() {
    const start = new Date(this._startTime);
    const end = new Date(start.getTime() + this._durationHours * 60 * 60 * 1000);
    const durationIso = this._formatIsoDuration(this._durationHours);

    const entry = {
      id: this._id,
      userId: this._userId,
      userName: this._userName,
      timeInterval: {
        start: this._startTime,
        end: end.toISOString(),
        duration: durationIso
      },
      hourlyRate: { amount: this._hourlyRate, currency: 'USD' },
      billable: this._billable,
      type: this._type,
      description: this._description,
      tags: this._tags
    };

    if (this._projectId) {
      entry.projectId = this._projectId;
      entry.projectName = this._projectName;
    }

    if (this._clientId) {
      entry.clientId = this._clientId;
      entry.clientName = this._clientName;
    }

    if (this._taskId) {
      entry.taskId = this._taskId;
      entry.taskName = this._taskName;
    }

    if (this._costRate !== null) {
      entry.costRate = { amount: this._costRate, currency: 'USD' };
    }

    return entry;
  }

  /**
   * Format duration as ISO 8601 duration string
   */
  _formatIsoDuration(hours) {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (m === 0) {
      return `PT${h}H`;
    }
    return `PT${h}H${m}M`;
  }

  /**
   * Create multiple entries at once (static factory)
   */
  static createMany(count, configureFn) {
    const entries = [];
    for (let i = 0; i < count; i++) {
      const builder = new EntryBuilder();
      configureFn(builder, i);
      entries.push(builder.build());
    }
    return entries;
  }

  /**
   * Create a standard 8-hour workday entry (static factory)
   */
  static standard8Hour(userId = 'user1', userName = 'TestUser') {
    return new EntryBuilder()
      .withUser(userId, userName)
      .withDuration(8)
      .billable()
      .build();
  }

  /**
   * Create an overtime entry (10 hours) (static factory)
   */
  static overtime10Hour(userId = 'user1', userName = 'TestUser') {
    return new EntryBuilder()
      .withUser(userId, userName)
      .withDuration(10)
      .billable()
      .build();
  }

  /**
   * Create a 1-hour break entry (static factory)
   */
  static oneHourBreak(userId = 'user1', userName = 'TestUser') {
    return new EntryBuilder()
      .withUser(userId, userName)
      .withDuration(1)
      .asBreak()
      .nonBillable()
      .startingAt('2025-01-15T12:00:00Z')
      .build();
  }
}

/**
 * StoreBuilder - Fluent API for creating test stores
 */
export class StoreBuilder {
  constructor() {
    this._users = [{ id: 'user1', name: 'TestUser' }];
    this._config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      overtimeBasis: 'daily',
      enableTieredOT: false
    };
    this._calcParams = {
      dailyThreshold: 8,
      weeklyThreshold: 40,
      overtimeMultiplier: 1.5,
      tier2ThresholdHours: 4,
      tier2Multiplier: 2.0
    };
    this._overrides = {};
    this._profiles = new Map();
    this._holidays = new Map();
    this._timeOff = new Map();
  }

  /**
   * Add users
   */
  withUsers(users) {
    this._users = users;
    return this;
  }

  /**
   * Add a single user
   */
  addUser(id, name) {
    this._users.push({ id, name });
    return this;
  }

  /**
   * Set daily threshold
   */
  withDailyThreshold(hours) {
    this._calcParams.dailyThreshold = hours;
    return this;
  }

  /**
   * Set overtime multiplier
   */
  withOvertimeMultiplier(multiplier) {
    this._calcParams.overtimeMultiplier = multiplier;
    return this;
  }

  /**
   * Enable tiered OT
   */
  withTieredOT(tier2ThresholdHours = 4, tier2Multiplier = 2.0) {
    this._config.enableTieredOT = true;
    this._calcParams.tier2ThresholdHours = tier2ThresholdHours;
    this._calcParams.tier2Multiplier = tier2Multiplier;
    return this;
  }

  /**
   * Disable tiered OT
   */
  withoutTieredOT() {
    this._config.enableTieredOT = false;
    return this;
  }

  /**
   * Add profile for user
   */
  withProfile(userId, profile) {
    this._profiles.set(userId, profile);
    return this;
  }

  /**
   * Add profile with standard working days
   */
  withStandardProfile(userId, capacityHours = 8) {
    this._profiles.set(userId, {
      workCapacityHours: capacityHours,
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
    });
    return this;
  }

  /**
   * Add holiday for user on date
   */
  withHoliday(userId, dateKey, name = 'Test Holiday') {
    if (!this._holidays.has(userId)) {
      this._holidays.set(userId, new Map());
    }
    this._holidays.get(userId).set(dateKey, { name });
    return this;
  }

  /**
   * Add time-off for user on date
   */
  withTimeOff(userId, dateKey, hours, isFullDay = false) {
    if (!this._timeOff.has(userId)) {
      this._timeOff.set(userId, new Map());
    }
    this._timeOff.get(userId).set(dateKey, { isFullDay, hours });
    return this;
  }

  /**
   * Add full-day time-off for user
   */
  withFullDayTimeOff(userId, dateKey) {
    return this.withTimeOff(userId, dateKey, 8, true);
  }

  /**
   * Set user overrides
   */
  withOverrides(userId, overrides) {
    this._overrides[userId] = overrides;
    return this;
  }

  /**
   * Set capacity override for user
   */
  withCapacityOverride(userId, capacity) {
    if (!this._overrides[userId]) {
      this._overrides[userId] = {};
    }
    this._overrides[userId].capacity = capacity;
    return this;
  }

  /**
   * Set per-day override for user
   */
  withPerDayOverride(userId, dateKey, overrideValues) {
    if (!this._overrides[userId]) {
      this._overrides[userId] = { mode: 'perDay', perDayOverrides: {} };
    }
    this._overrides[userId].mode = 'perDay';
    if (!this._overrides[userId].perDayOverrides) {
      this._overrides[userId].perDayOverrides = {};
    }
    this._overrides[userId].perDayOverrides[dateKey] = overrideValues;
    return this;
  }

  /**
   * Set weekly override for user
   */
  withWeeklyOverride(userId, dayOfWeek, overrideValues) {
    if (!this._overrides[userId]) {
      this._overrides[userId] = { mode: 'weekly', weeklyOverrides: {} };
    }
    this._overrides[userId].mode = 'weekly';
    if (!this._overrides[userId].weeklyOverrides) {
      this._overrides[userId].weeklyOverrides = {};
    }
    this._overrides[userId].weeklyOverrides[dayOfWeek] = overrideValues;
    return this;
  }

  /**
   * Disable holidays
   */
  withoutHolidays() {
    this._config.applyHolidays = false;
    return this;
  }

  /**
   * Disable time-off
   */
  withoutTimeOff() {
    this._config.applyTimeOff = false;
    return this;
  }

  /**
   * Disable profile capacity
   */
  withoutProfileCapacity() {
    this._config.useProfileCapacity = false;
    return this;
  }

  /**
   * Build the store object
   */
  build() {
    return {
      users: this._users,
      config: this._config,
      calcParams: this._calcParams,
      overrides: this._overrides,
      profiles: this._profiles,
      holidays: this._holidays,
      timeOff: this._timeOff
    };
  }
}

export default { EntryBuilder, StoreBuilder };
