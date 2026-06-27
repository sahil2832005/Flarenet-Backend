/**
 * Compliance Configuration - Phase 2
 * Auto-generates security and compliance requirements based on selected standards
 */

/**
 * Compliance standard definitions
 */
const COMPLIANCE_STANDARDS = {
    soc2: {
        name: 'SOC 2',
        description: 'Service Organization Control 2 - Security audit requirements',
        requirements: {
            encryption: {
                atRest: 'AES-256',
                inTransit: 'TLS 1.2+',
                keyManagement: 'Centralized key storage'
            },
            logging: {
                enabled: true,
                retention: '1 year',
                immutable: true,
                auditTrail: true,
                content: ['Access logs', 'Change logs', 'Error logs', 'Security events']
            },
            accessControl: {
                mfa: 'recommended',
                rbac: true,
                sessionTimeout: 30, // minutes
                passwordPolicy: {
                    minLength: 12,
                    complexity: true,
                    rotation: 90 // days
                }
            },
            monitoring: {
                uptime: true,
                security: true,
                performance: true,
                alerting: true
            },
            changeManagement: {
                versionControl: true,
                approvalProcess: true,
                rollbackCapability: true
            }
        },
        networkRequirements: {
            isolation: 'shared',  // Minimum - shared is OK
            firewall: true,
            ids: false
        }
    },

    hipaa: {
        name: 'HIPAA',
        description: 'Health Insurance Portability and Accountability Act',
        requirements: {
            encryption: {
                atRest: 'AES-256',
                inTransit: 'TLS 1.3',
                keyManagement: 'HSM or KMS with rotation',
                keyRotation: 90 // days
            },
            logging: {
                enabled: true,
                retention: '6 years',
                immutable: true,
                auditTrail: true,
                phiAccess: true,  // Log all PHI access
                content: ['All access to PHI', 'Authentication events', 'System changes', 'Data exports']
            },
            accessControl: {
                mfa: 'required',
                rbac: true,
                minimumAccess: true,  // Principle of least privilege
                sessionTimeout: 15,
                autoLogout: true,
                accessReview: 'quarterly'
            },
            backup: {
                enabled: true,
                encrypted: true,
                frequency: 'daily',
                retention: '6 years',
                offsite: true,
                tested: 'quarterly'
            },
            dataProtection: {
                anonymization: true,
                minimization: true,
                disposal: 'secure-wipe'
            }
        },
        networkRequirements: {
            isolation: 'dedicated_vlan',  // Minimum - must be isolated
            firewall: true,
            ids: true,
            vpn: 'optional'
        }
    },

    gdpr: {
        name: 'GDPR',
        description: 'General Data Protection Regulation (EU)',
        requirements: {
            encryption: {
                atRest: 'AES-256',
                inTransit: 'TLS 1.2+',
                pseudonymization: 'recommended'
            },
            logging: {
                enabled: true,
                retention: '3 years',
                auditTrail: true,
                content: ['Data access', 'Consent records', 'Data exports', 'Deletion requests']
            },
            dataRights: {
                rightToAccess: true,
                rightToErasure: true,  // Right to be forgotten
                rightToPortability: true,
                rightToRectification: true,
                consentManagement: true
            },
            dataProtection: {
                dataResidency: 'EU',
                crossBorderTransfer: 'restricted',
                privacyByDesign: true,
                dpia: true  // Data Protection Impact Assessment
            },
            breach: {
                notificationTime: 72, // hours
                documentationRequired: true
            }
        },
        networkRequirements: {
            isolation: 'shared',
            firewall: true,
            dataResidency: 'EU'
        }
    },

    pci: {
        name: 'PCI-DSS',
        description: 'Payment Card Industry Data Security Standard',
        requirements: {
            encryption: {
                atRest: 'AES-256',
                inTransit: 'TLS 1.2+',
                panMasking: true,  // Mask card numbers
                keyRotation: 'annual'
            },
            logging: {
                enabled: true,
                retention: '1 year',
                immutable: true,
                auditTrail: true,
                ntpSync: true,  // Time synchronization
                content: ['All access to cardholder data', 'Authentication', 'Changes to security config']
            },
            accessControl: {
                mfa: 'required',
                rbac: true,
                uniqueIds: true,  // Unique ID per user
                sessionTimeout: 15,
                accessReview: 'quarterly'
            },
            network: {
                segmentation: true,  // CDE must be segmented
                firewall: true,
                waf: true,
                internalScanning: 'weekly',
                externalScanning: 'quarterly',
                penetrationTesting: 'annual'
            },
            vulnerability: {
                scanning: 'weekly',
                patching: '30 days critical',
                antimalware: true
            }
        },
        networkRequirements: {
            isolation: 'dedicated_vlan',  // MUST be segmented
            firewall: true,
            waf: true,
            ids: true
        }
    },

    iso27001: {
        name: 'ISO 27001',
        description: 'Information Security Management System',
        requirements: {
            encryption: {
                atRest: 'AES-256',
                inTransit: 'TLS 1.2+',
                keyManagement: 'documented'
            },
            logging: {
                enabled: true,
                retention: '3 years',
                auditTrail: true,
                review: 'monthly'
            },
            accessControl: {
                mfa: 'recommended',
                rbac: true,
                accessReview: 'annual',
                segregationOfDuties: true
            },
            riskManagement: {
                assessment: 'annual',
                treatment: 'documented',
                monitoring: 'continuous'
            },
            incidents: {
                responseProcess: true,
                documentation: true,
                lessonsLearned: true
            },
            continuity: {
                bcp: true,  // Business Continuity Plan
                drp: true,  // Disaster Recovery Plan
                testing: 'annual'
            }
        },
        networkRequirements: {
            isolation: 'shared',
            firewall: true,
            ids: 'recommended'
        }
    }
};

/**
 * Network isolation requirements
 */
const NETWORK_ISOLATION_LEVELS = {
    shared: {
        level: 1,
        name: 'Shared Network',
        description: 'Standard container isolation'
    },
    dedicated_vlan: {
        level: 2,
        name: 'Dedicated VLAN',
        description: 'Separate network segment'
    },
    private: {
        level: 3,
        name: 'Private Network',
        description: 'Fully isolated, no public access'
    }
};

/**
 * Generate compliance configuration based on selected standards
 * @param {Array} complianceList - List of compliance standards selected
 * @param {string} networkIsolation - Selected network isolation level
 * @returns {Object} - Merged compliance configuration
 */
function generateComplianceConfig(complianceList, networkIsolation) {
    // Handle 'none' case
    if (!complianceList || complianceList.length === 0 || complianceList.includes('none')) {
        return {
            enabled: false,
            standards: [],
            requirements: getBaselineSecurityConfig(),
            warnings: []
        };
    }

    const config = {
        enabled: true,
        standards: [],
        requirements: {
            encryption: {},
            logging: {},
            accessControl: {},
            backup: {},
            network: {},
            monitoring: {}
        },
        warnings: [],
        checklist: []
    };

    // Merge requirements from all selected standards
    complianceList.forEach(standard => {
        const standardConfig = COMPLIANCE_STANDARDS[standard];
        if (standardConfig) {
            config.standards.push({
                id: standard,
                name: standardConfig.name,
                description: standardConfig.description
            });

            // Merge requirements (stricter wins)
            mergeRequirements(config.requirements, standardConfig.requirements);

            // Check network isolation requirement
            const requiredIsolation = NETWORK_ISOLATION_LEVELS[standardConfig.networkRequirements.isolation];
            const currentIsolation = NETWORK_ISOLATION_LEVELS[networkIsolation];

            if (currentIsolation && requiredIsolation && currentIsolation.level < requiredIsolation.level) {
                config.warnings.push({
                    type: 'network_compliance',
                    severity: 'critical',
                    standard: standardConfig.name,
                    message: `${standardConfig.name} requires ${requiredIsolation.name} or higher. You selected ${currentIsolation.name}.`,
                    recommendation: `Upgrade network isolation to "${standardConfig.networkRequirements.isolation}" or higher`
                });
            }
        }
    });

    // Generate compliance checklist
    config.checklist = generateChecklist(config.requirements, config.standards);

    return config;
}

/**
 * Merge requirements from multiple standards (stricter wins)
 */
function mergeRequirements(target, source) {
    for (const category in source) {
        if (!target[category]) {
            target[category] = {};
        }

        for (const key in source[category]) {
            const sourceValue = source[category][key];
            const targetValue = target[category][key];

            // Stricter value wins
            if (targetValue === undefined) {
                target[category][key] = sourceValue;
            } else if (typeof sourceValue === 'boolean') {
                target[category][key] = targetValue || sourceValue;  // true wins
            } else if (typeof sourceValue === 'number') {
                // For retention, longer wins; for timeouts, shorter wins
                if (key.includes('retention') || key.includes('years')) {
                    target[category][key] = Math.max(targetValue, sourceValue);
                } else {
                    target[category][key] = Math.min(targetValue, sourceValue);
                }
            } else if (typeof sourceValue === 'string') {
                // For requirements like 'required' vs 'recommended', stricter wins
                if (sourceValue === 'required' || targetValue === 'required') {
                    target[category][key] = 'required';
                } else {
                    target[category][key] = sourceValue;
                }
            } else if (Array.isArray(sourceValue)) {
                target[category][key] = [...new Set([...(targetValue || []), ...sourceValue])];
            }
        }
    }
}

/**
 * Get baseline security config (when no compliance selected)
 */
function getBaselineSecurityConfig() {
    return {
        encryption: {
            atRest: 'AES-256',
            inTransit: 'TLS 1.2+'
        },
        logging: {
            enabled: true,
            retention: '30 days',
            content: ['Error logs', 'Access logs']
        },
        accessControl: {
            mfa: 'optional',
            sessionTimeout: 60
        },
        backup: {
            enabled: true,
            frequency: 'daily',
            retention: '30 days'
        }
    };
}

/**
 * Generate compliance checklist for UI
 */
function generateChecklist(requirements, standards) {
    const checklist = [];
    const standardNames = standards.map(s => s.name).join(', ');

    // Encryption items
    if (requirements.encryption) {
        checklist.push({
            category: 'Encryption',
            items: [
                { 
                    name: 'Encryption at Rest', 
                    value: requirements.encryption.atRest,
                    required: true
                },
                { 
                    name: 'Encryption in Transit', 
                    value: requirements.encryption.inTransit,
                    required: true
                },
                requirements.encryption.keyRotation ? {
                    name: 'Key Rotation',
                    value: `Every ${requirements.encryption.keyRotation} days`,
                    required: true
                } : null
            ].filter(Boolean)
        });
    }

    // Logging items
    if (requirements.logging) {
        checklist.push({
            category: 'Logging & Audit',
            items: [
                { 
                    name: 'Audit Logging', 
                    value: requirements.logging.enabled ? 'Enabled' : 'Disabled',
                    required: true
                },
                { 
                    name: 'Log Retention', 
                    value: requirements.logging.retention,
                    required: true
                },
                { 
                    name: 'Immutable Logs', 
                    value: requirements.logging.immutable ? 'Yes' : 'No',
                    required: requirements.logging.immutable
                }
            ]
        });
    }

    // Access Control items
    if (requirements.accessControl) {
        checklist.push({
            category: 'Access Control',
            items: [
                { 
                    name: 'Multi-Factor Auth', 
                    value: requirements.accessControl.mfa === 'required' ? 'Required' : 'Recommended',
                    required: requirements.accessControl.mfa === 'required'
                },
                { 
                    name: 'Role-Based Access', 
                    value: requirements.accessControl.rbac ? 'Enabled' : 'Disabled',
                    required: true
                },
                { 
                    name: 'Session Timeout', 
                    value: `${requirements.accessControl.sessionTimeout} minutes`,
                    required: true
                }
            ]
        });
    }

    // Backup items
    if (requirements.backup) {
        checklist.push({
            category: 'Backup & Recovery',
            items: [
                { 
                    name: 'Automated Backup', 
                    value: requirements.backup.enabled ? 'Enabled' : 'Disabled',
                    required: true
                },
                { 
                    name: 'Backup Encryption', 
                    value: requirements.backup.encrypted ? 'Encrypted' : 'Plain',
                    required: requirements.backup.encrypted
                },
                requirements.backup.offsite ? {
                    name: 'Offsite Backup',
                    value: 'Required',
                    required: true
                } : null
            ].filter(Boolean)
        });
    }

    return checklist;
}

/**
 * Check if network isolation meets compliance requirements
 */
function checkNetworkCompliance(complianceList, networkIsolation) {
    const warnings = [];
    
    complianceList.forEach(standard => {
        const standardConfig = COMPLIANCE_STANDARDS[standard];
        if (standardConfig) {
            const required = NETWORK_ISOLATION_LEVELS[standardConfig.networkRequirements.isolation];
            const current = NETWORK_ISOLATION_LEVELS[networkIsolation];
            
            if (current && required && current.level < required.level) {
                warnings.push({
                    standard: standardConfig.name,
                    required: standardConfig.networkRequirements.isolation,
                    current: networkIsolation
                });
            }
        }
    });
    
    return warnings;
}

/**
 * Get minimum required network isolation for compliance list
 */
function getMinimumNetworkIsolation(complianceList) {
    let maxLevel = 0;
    let requiredIsolation = 'shared';
    
    complianceList.forEach(standard => {
        const standardConfig = COMPLIANCE_STANDARDS[standard];
        if (standardConfig) {
            const isolation = NETWORK_ISOLATION_LEVELS[standardConfig.networkRequirements.isolation];
            if (isolation && isolation.level > maxLevel) {
                maxLevel = isolation.level;
                requiredIsolation = standardConfig.networkRequirements.isolation;
            }
        }
    });
    
    return requiredIsolation;
}

module.exports = {
    COMPLIANCE_STANDARDS,
    NETWORK_ISOLATION_LEVELS,
    generateComplianceConfig,
    checkNetworkCompliance,
    getMinimumNetworkIsolation,
    getBaselineSecurityConfig
};
