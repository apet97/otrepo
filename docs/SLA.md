# OTPLUS Service Level Agreement (SLA) & Service Level Objectives (SLOs)

**Version:** 1.0
**Effective Date:** February 1, 2026
**Last Updated:** February 3, 2026

---

## 1. Overview

This document defines the Service Level Agreement (SLA) and Service Level Objectives (SLOs) for the OTPLUS Overtime Addon. These targets establish the operational quality standards users can expect and provide measurable criteria for monitoring system health.

### 1.1 Scope

This SLA applies to:
- OTPLUS Addon running within the Clockify platform
- Report generation functionality
- Data export capabilities
- User interface responsiveness

This SLA does NOT cover:
- Clockify platform availability (governed by Clockify's own SLA)
- Third-party API rate limits imposed by Clockify
- User's local network or browser issues
- Scheduled maintenance windows (announced 48 hours in advance)

---

## 2. Service Level Objectives (SLOs)

### 2.1 Availability

| Metric | Target | Measurement Period |
|--------|--------|-------------------|
| **Uptime** | 99.5% | Monthly |
| **Planned Downtime** | < 4 hours | Monthly |
| **Unplanned Downtime** | < 2 hours | Monthly |

**Availability Calculation:**
```
Availability % = (Total Minutes - Downtime Minutes) / Total Minutes × 100
```

**Monthly Availability Targets:**
- 99.5% = ~3.6 hours downtime allowed per month
- 99.9% = ~43 minutes downtime allowed per month (stretch goal)

### 2.2 Performance

#### 2.2.1 Report Generation

| Scenario | Target Response Time | 95th Percentile |
|----------|---------------------|-----------------|
| Small report (1-10 users, 7 days) | < 3 seconds | < 5 seconds |
| Medium report (10-50 users, 30 days) | < 10 seconds | < 15 seconds |
| Large report (50-100 users, 30 days) | < 20 seconds | < 30 seconds |
| Maximum report (100+ users, 90 days) | < 45 seconds | < 60 seconds |

**Note:** These targets assume optimal Clockify API response times. Actual performance may vary based on Clockify's infrastructure load.

#### 2.2.2 UI Responsiveness

| Interaction | Target | Maximum |
|-------------|--------|---------|
| Page load (initial) | < 2 seconds | < 4 seconds |
| Tab switching | < 100ms | < 300ms |
| Configuration changes | < 200ms | < 500ms |
| CSV export generation | < 3 seconds | < 10 seconds |
| Pagination navigation | < 100ms | < 300ms |

#### 2.2.3 API Rate Limiting

| Metric | Target |
|--------|--------|
| Request throughput | 50 requests/second (burst) |
| Sustained throughput | 50 requests/second |
| Rate limit recovery | < 5 seconds |

### 2.3 Data Integrity

| Metric | Target |
|--------|--------|
| Calculation accuracy | 100% |
| Data loss prevention | 0 incidents |
| Export data integrity | 100% match with source |

**Validation:**
- All calculations verified by 100% unit test coverage
- Mutation testing ensures calculation correctness
- Regression tests run on every deployment

### 2.4 Error Rates

| Metric | Target | Action Threshold |
|--------|--------|------------------|
| Client-side errors | < 0.1% of sessions | > 1% triggers investigation |
| API failures (non-rate-limit) | < 0.5% of requests | > 2% triggers investigation |
| Circuit breaker activations | < 1 per week | > 3 per day triggers escalation |

---

## 3. Monitoring & Alerting

### 3.1 Key Metrics to Monitor

| Metric | Collection Method | Alert Threshold |
|--------|------------------|-----------------|
| Report generation time | Client-side timing | > 30 seconds avg |
| API error rate | Error tracking (Sentry) | > 2% over 5 min window |
| Circuit breaker state | Application logs | Any OPEN state |
| Cache hit rate | Application metrics | < 50% (investigate) |
| Memory usage | Browser performance API | > 500MB |

### 3.2 Alerting Tiers

| Tier | Response Time | Examples |
|------|---------------|----------|
| **P1 - Critical** | < 15 minutes | Service completely unavailable, data corruption |
| **P2 - High** | < 1 hour | Major feature broken, >5% error rate |
| **P3 - Medium** | < 4 hours | Performance degradation, minor feature issues |
| **P4 - Low** | < 24 hours | Cosmetic issues, documentation errors |

### 3.3 Health Check Indicators

The addon reports health status through:
1. **API connectivity** - Can reach Clockify APIs
2. **Authentication** - Valid JWT token
3. **Cache status** - localStorage/sessionStorage available
4. **Circuit breaker** - CLOSED (healthy) or OPEN (degraded)

---

## 4. Incident Response

### 4.1 Incident Severity Levels

| Level | Definition | Response Target | Resolution Target |
|-------|------------|-----------------|-------------------|
| **SEV1** | Complete service outage | 15 minutes | 4 hours |
| **SEV2** | Major functionality impaired | 30 minutes | 8 hours |
| **SEV3** | Minor functionality impaired | 2 hours | 24 hours |
| **SEV4** | Cosmetic or minor issues | 24 hours | 72 hours |

### 4.2 Escalation Path

1. **First Response** - On-call engineer acknowledges incident
2. **Initial Assessment** - Severity determined within 15 minutes
3. **Communication** - Status page updated for SEV1/SEV2
4. **Resolution** - Fix deployed and verified
5. **Post-mortem** - Conducted within 48 hours for SEV1/SEV2

### 4.3 Communication

| Incident Type | Notification Method | Frequency |
|--------------|---------------------|-----------|
| Planned maintenance | Email, 48h advance | Once |
| SEV1 outage | Status page + Email | Every 30 min |
| SEV2 degradation | Status page | Every 60 min |
| Resolution | Status page + Email | Once |

---

## 5. Maintenance Windows

### 5.1 Scheduled Maintenance

| Window | Time (UTC) | Frequency |
|--------|------------|-----------|
| Primary | Sunday 02:00-06:00 | As needed |
| Secondary | Wednesday 02:00-04:00 | Monthly |

**Notice Requirements:**
- Standard maintenance: 48 hours notice
- Emergency maintenance: Best effort notification

### 5.2 Maintenance Types

| Type | Expected Downtime | Notice |
|------|-------------------|--------|
| Version deployment | < 5 minutes | 48 hours |
| Security patch | < 15 minutes | 24 hours (or emergency) |
| Infrastructure update | < 30 minutes | 48 hours |

---

## 6. Capacity Limits

### 6.1 Operational Limits

| Resource | Soft Limit | Hard Limit |
|----------|------------|------------|
| Users per workspace | 100 | 200 |
| Date range | 90 days | 365 days |
| Entries per report | 10,000 | 25,000 |
| Pages per API call | 50 | 50 |
| localStorage usage | 5 MB | 10 MB |

### 6.2 Performance at Limits

| Scenario | Expected Behavior |
|----------|-------------------|
| Approaching soft limit | Warning displayed, full functionality |
| At hard limit | Graceful degradation, partial results |
| Exceeding hard limit | Operation blocked with user notification |

---

## 7. Support Tiers

### 7.1 Support Levels

| Tier | Response Time | Availability | Channels |
|------|---------------|--------------|----------|
| **Standard** | 24 hours | Business hours | Email, GitHub Issues |
| **Priority** | 4 hours | Business hours | Email, GitHub Issues |
| **Enterprise** | 1 hour | 24/7 | Email, Phone, Slack |

### 7.2 Support Scope

**In Scope:**
- Bug reports and troubleshooting
- Configuration assistance
- Feature requests (logged for consideration)
- Performance optimization guidance

**Out of Scope:**
- Clockify platform issues
- Custom development
- Training (documentation provided)
- Data recovery (client-side application)

---

## 8. SLA Compliance Reporting

### 8.1 Monthly Reports

Monthly SLA reports include:
- Availability percentage
- Incident count by severity
- Mean time to resolution (MTTR)
- Performance metrics vs. targets
- Trend analysis

### 8.2 Quarterly Reviews

Quarterly business reviews cover:
- SLA compliance summary
- Significant incidents and learnings
- Capacity planning updates
- Roadmap alignment

---

## 9. Exclusions

The following are excluded from SLA calculations:

1. **Force Majeure** - Natural disasters, acts of war, government actions
2. **Third-Party Failures** - Clockify platform outages, browser bugs
3. **Customer-Caused Issues** - Misconfiguration, unsupported browsers
4. **Scheduled Maintenance** - Pre-announced maintenance windows
5. **Beta Features** - Features explicitly marked as beta/experimental

---

## 10. Definitions

| Term | Definition |
|------|------------|
| **Availability** | Percentage of time the service is operational |
| **Downtime** | Period when core functionality is unavailable |
| **Incident** | Any event that disrupts normal service operation |
| **MTTR** | Mean Time To Resolution - average time to resolve incidents |
| **MTTD** | Mean Time To Detection - average time to detect incidents |
| **P95** | 95th percentile - value below which 95% of observations fall |

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | February 1, 2026 | Initial SLA document |
| 1.1 | February 3, 2026 | Updated health check references, aligned with enterprise features |

---

## 12. Contact

For SLA-related inquiries or to report incidents:

- **GitHub Issues:** https://github.com/otplus/overtime-addon/issues
- **Status Page:** [To be configured]
- **Email:** support@otplus.example.com

---

*This SLA is subject to periodic review and updates. Users will be notified of material changes 30 days in advance.*
