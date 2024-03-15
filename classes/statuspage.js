const axios = require('axios');

class StatusPage {
    constructor(config, db) {
        this.config = config.statusPage
        this.incidents = {}
        this.db = db;
        this.db.init()
            .then(() => {
                this.db.getActiveIncidents()
                    .then((incidents) => {
                        incidents.forEach((incident) => {
                            this.incidents[incident.name] = JSON.parse(incident.data);
                        });
                    });
            });
    }

    _computeImpact(service_status) {
        switch (service_status) {
            case "ok":
                return "resolved";
            case "error":
                return "critical";
            case "warning":
                return "major";
            case "low_performance":
                return "minor";
            default:
                return "maintenance";
        }
    }

    _computeStatus(service_status) {
        switch (service_status) {
            case "ok":
                return "resolved";
            case "error":
                return "critical";
            case "warning":
                return "major";
            case "low_performance":
                return "minor";
            default:
                return "maintenance";
        }
    }

    _computeComponentStatus(service_status) {
        switch (service_status) {
            case "ok":
                return "operational";
            case "error":
                return "major_outage";
            case "warning":
                return "partial_outage";
            case "low_performance":
                return "degraded_performance";
            default:
                return "under_maintenance";
        }
    }

    _computeStatusSeverity(service_status) {
        switch (service_status) {
            case "ok":
                return 0;
            case "error":
                return 3
            case "warning":
                return 2;
            case "low_performance":
                return 1;
            default:
                return 4;
        }
    }

    _computeUpdatedBody(service) {
        const service_display = service.display_name;
        const current_severity = this._computeStatusSeverity(service.status);
        const previous_severity = this._computeStatusSeverity(this.incidents[service.name].incident.status);

        if (current_severity === 0 && previous_severity !== 0) {
            return {
                body: `The service "${service_display}" is now back to normal.`,
                status: "completed"
            }
        }
        if (current_severity === 1 && previous_severity > 1) {
            return {
                body: `The service "${service_display}" seems to be recovering, but the performance is still degraded.`,
                status: "verifying"
            }
        }
        if (current_severity === 2 && previous_severity > 1) {
            return {
                body: `The service "${service_display}" is now experiencing minor issues.`,
                status: "verifying"
            }
        }
        if (current_severity === 3 && previous_severity > 1) {
            return {
                body: `The service "${service_display}" is now experiencing major issues.`,
                status: "verifying"
            }
        }
        if (current_severity === 4 && previous_severity !== 4) {
            return {
                body: `The service "${service_display}" is now under maintenance.`,
                status: "in_progress"
            }
        }
    }

    updateStatusPage(service) {
        const service_name = service.name;
        const service_severity = this._computeStatusSeverity(service.status);

        if (this.incidents[service_name]) {
            console.log(this.incidents[service_name].severity, service_severity)
            if (this.incidents[service_name].severity !== service_severity) {
                this.updateIncident(service);
            }
        } else {
            if (service_severity !== 0)
                this.createIncident(service);
        };
    }

    updateIncident(service) {
        const startDate = new Date();
        const plannedEndDate = new Date(startDate);
        plannedEndDate.setDate(plannedEndDate.getDate() + 4);
        const bodyData = this._computeUpdatedBody(service);
        const data = {
            id: this.incidents[service.name].id,
            severity: this._computeStatusSeverity(service.status),
            incident: {
                name: `${service.display_name} incident, ${service.error}`,
                status: bodyData.status,
                body: bodyData.body,
                components: {
                    [this.config.components[service.name]]: this._computeComponentStatus(service.status)
                },
                deliver_notifications: this._computeStatus(service.status) == "critical" ? true : false,
                severity: this._computeStatusSeverity(service.status),
                scheduled_for: startDate,
                scheduled_until: plannedEndDate,
                auto_transition_to_maintenance_state: false,
                auto_transition_to_operational_state: false,
            }
        }
        this.patchIncident(data, service.name);
    }

    createIncident(service) {
        const service_name = service.name;
        const service_status = service.status;
        const service_error = service.error;
        const service_display = service.display_name;

        const body = `The service "${service_display}" is currently experiencing issues.\nThe error reported is: <b>${service_error}</b> and the status of the service is now <b>${service_status}</b>${this.config.footerMessage}`
        const startDate = new Date();
        const plannedEndDate = new Date(startDate);
        plannedEndDate.setDate(plannedEndDate.getDate() + 4);
        const data = {
            severity: this._computeStatusSeverity(service_status),
            incident: {
                name: `${service_display} incident, ${service_error}`,
                status: "in_progress",
                impact_override: this._computeStatus(service_status),
                body,
                auto_transition_to_maintenance_state: false,
                auto_transition_to_operational_state: false,
                component_ids: [ this.config.components[service_name] ],
                components: {
                    [this.config.components[service_name]]: this._computeComponentStatus(service_status)
                },
                scheduled_for: startDate,
                scheduled_until: plannedEndDate,
                deliver_notifications: this._computeStatus(service_status) == "critical" ? true : false,
            }
        }
        this.postIncident(data, service_name);
    }

    postIncident(incident, service_name) {
        axios.post(`${this.config.url}/pages/${this.config.PAGE_ID}/incidents`, incident, {
            headers: {
                "Authorization": `OAuth ${this.config.API_KEY}`,
            }
        })
            .then((response) => {
                console.log("[STATUSPAGE] " + service_name + " incident created");
                this.incidents[service_name] = incident;
                this.incidents[service_name].id = response.data.id;
                this.db.addIncident(response.data);
            })
            .catch((error) => {
                console.log("[STATUSPAGE] " + service_name + " incident creation failed");
                console.error(error.response.data);
            });
    }

    patchIncident(incident, service_name) {
        axios.put(`${this.config.url}/pages/${this.config.PAGE_ID}/incidents/${incident.id}`, incident, {
            headers: {
                "Authorization": `OAuth ${this.config.API_KEY}`,
            }
        })
            .then((response) => {
                console.log("[STATUSPAGE] " + service_name + " incident updated");
                this.incidents[service_name] = incident;
                this.incidents[service_name].id = response.data.id;
                this.db.addIncident(response.data);
            })
            .catch((error) => {
                console.log("[STATUSPAGE] " + service_name + " incident update failed");
                console.error(error.response.data);
            });
    }

}

module.exports = StatusPage;