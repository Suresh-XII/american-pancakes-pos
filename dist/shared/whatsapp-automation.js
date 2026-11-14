"use strict";
/**
 * Shared WhatsApp automation contract, pure template renderer, defaults,
 * and safety helpers used by both the Electron/Express main process and
 * the Next.js frontend.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHATSAPP_PLACEHOLDERS = exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT = exports.DEFAULT_WHATSAPP_AUTOMATION_CONFIG = exports.DEFAULT_WHATSAPP_SAFETY = exports.DEFAULT_WHATSAPP_RULES = exports.DEFAULT_WHATSAPP_TEMPLATES = exports.WHATSAPP_PLACEHOLDER_KEYS = exports.WHATSAPP_PLACEHOLDER_GROUPS = exports.WHATSAPP_AUTOMATION_SETTING_KEY = void 0;
exports.renderWhatsAppTemplate = renderWhatsAppTemplate;
exports.buildSampleWhatsAppContext = buildSampleWhatsAppContext;
exports.resolveWhatsAppRuleTrigger = resolveWhatsAppRuleTrigger;
exports.normalizeWhatsAppAutomationConfig = normalizeWhatsAppAutomationConfig;
exports.isAutoOptOutText = isAutoOptOutText;
exports.isTimeWithinQuietHours = isTimeWithinQuietHours;
exports.extractTriggerRule = extractTriggerRule;
exports.WHATSAPP_AUTOMATION_SETTING_KEY = 'whatsapp_automation_config';
exports.WHATSAPP_PLACEHOLDER_GROUPS = {
    customer: ['customer_name', 'customer_phone', 'visit_count', 'last_visit_date', 'total_spent'],
    order: ['bill_no', 'order_date', 'order_items', 'total', 'payment_method'],
    loyalty: ['points_earned', 'points_balance', 'points_value'],
    store: ['store_name', 'store_phone', 'feedback_link', 'instagram'],
};
exports.WHATSAPP_PLACEHOLDER_KEYS = [
    ...exports.WHATSAPP_PLACEHOLDER_GROUPS.customer,
    ...exports.WHATSAPP_PLACEHOLDER_GROUPS.order,
    ...exports.WHATSAPP_PLACEHOLDER_GROUPS.loyalty,
    ...exports.WHATSAPP_PLACEHOLDER_GROUPS.store,
];
exports.DEFAULT_WHATSAPP_TEMPLATES = [
    {
        id: 'receipt',
        name: 'Digital Receipt',
        body: [
            'Dear {customer_name},',
            'Your purchase at {store_name} has been completed.',
            'Bill #: {bill_no} ({order_date})',
            '',
            'Items:',
            '{order_items}',
            '',
            'Total: {total} ({payment_method})',
            'You have earned {points_earned} points on this purchase.',
            'Updated balance: {points_balance} ({points_value})',
            'Share feedback: {feedback_link}',
            'Reply STOP to opt out.',
        ].join('\n'),
    },
    {
        id: 'feedback',
        name: 'Feedback Request',
        body: [
            'Hi {customer_name}, thank you for visiting {store_name}!',
            'We would love to hear how your order (#{bill_no}) was today.',
            'Share your feedback: {feedback_link}',
            'Follow us: {instagram}',
            'Reply STOP to opt out.',
        ].join('\n'),
    },
    {
        id: 'loyalty_milestone',
        name: 'Loyalty & Milestone Reward',
        body: [
            'Congratulations {customer_name}!',
            'You have earned {points_earned} points at {store_name} and your loyalty balance is now {points_balance} points (worth {points_value}).',
            'Redeem your points on your next visit!',
            'Reply STOP to opt out.',
        ].join('\n'),
    },
    {
        id: 'visit_milestone',
        name: 'Visit Milestone Reward',
        body: [
            'Thank you for {visit_count} visits to {store_name}, {customer_name}!',
            'Total spent with us: {total_spent}. Current points balance: {points_balance} ({points_value}).',
            'We appreciate your loyalty and look forward to seeing you again!',
            'Reply STOP to opt out.',
        ].join('\n'),
    },
    {
        id: 'winback',
        name: 'Win-Back Reminder',
        body: [
            'Hi {customer_name}, we miss you at {store_name}!',
            'Your last visit was on {last_visit_date}, and you have {points_balance} points ({points_value}) ready to use.',
            'See you soon! Contact: {store_phone}',
            'Reply STOP to opt out.',
        ].join('\n'),
    },
];
exports.DEFAULT_WHATSAPP_RULES = [
    {
        id: 'after_payment',
        trigger: 'after_payment',
        enabled: false,
        templateId: 'receipt',
    },
    {
        id: 'feedback_delay',
        trigger: 'feedback_delay',
        enabled: false,
        templateId: 'feedback',
        delayHours: 2,
    },
    {
        id: 'winback',
        trigger: 'winback',
        enabled: false,
        templateId: 'winback',
        inactiveDays: 14,
    },
    {
        id: 'points_threshold',
        trigger: 'points_threshold',
        enabled: false,
        templateId: 'loyalty_milestone',
        pointsThreshold: 100,
    },
    {
        id: 'nth_visit',
        trigger: 'nth_visit',
        enabled: false,
        templateId: 'visit_milestone',
        nthVisit: 5,
    },
    {
        id: 'z_report_day_close',
        trigger: 'z_report_day_close',
        enabled: false,
        templateId: 'receipt',
        recipientPhone: '',
    },
];
exports.DEFAULT_WHATSAPP_SAFETY = {
    autoOptOutEnabled: true,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '09:00',
    maxPerCustomerPerWeek: 5,
    feedbackLink: '',
};
exports.DEFAULT_WHATSAPP_AUTOMATION_CONFIG = {
    templates: exports.DEFAULT_WHATSAPP_TEMPLATES.map((t) => ({ ...t })),
    rules: exports.DEFAULT_WHATSAPP_RULES.map((r) => ({ ...r })),
    safety: { ...exports.DEFAULT_WHATSAPP_SAFETY },
};
exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT = {
    customer_name: 'Aarav Sharma',
    customer_phone: '+919876543210',
    visit_count: '5',
    last_visit_date: '2026-10-15',
    total_spent: '2,450.00',
    bill_no: 'INV-1042',
    order_date: '2026-10-22 14:30',
    order_items: '2x Masala Chai - 120.00\n1x Paneer Tikka Wrap - 240.00',
    total: '360.00',
    payment_method: 'Cash',
    points_earned: '36',
    points_balance: '180',
    points_value: '180.00',
    store_name: 'Flo Cafe',
    store_phone: '+919800000000',
    feedback_link: 'https://flocafe.example.com/feedback',
    instagram: '@flocafe',
};
exports.WHATSAPP_PLACEHOLDERS = [
    {
        key: 'customer_name',
        token: '{customer_name}',
        category: 'customer',
        label: 'Customer Name',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.customer_name,
    },
    {
        key: 'customer_phone',
        token: '{customer_phone}',
        category: 'customer',
        label: 'Customer Phone',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.customer_phone,
    },
    {
        key: 'visit_count',
        token: '{visit_count}',
        category: 'customer',
        label: 'Visit Count',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.visit_count,
    },
    {
        key: 'last_visit_date',
        token: '{last_visit_date}',
        category: 'customer',
        label: 'Last Visit Date',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.last_visit_date,
    },
    {
        key: 'total_spent',
        token: '{total_spent}',
        category: 'customer',
        label: 'Total Spent',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.total_spent,
    },
    {
        key: 'bill_no',
        token: '{bill_no}',
        category: 'order',
        label: 'Bill #',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.bill_no,
    },
    {
        key: 'order_date',
        token: '{order_date}',
        category: 'order',
        label: 'Order Date',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.order_date,
    },
    {
        key: 'order_items',
        token: '{order_items}',
        category: 'order',
        label: 'Order Items',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.order_items,
    },
    {
        key: 'total',
        token: '{total}',
        category: 'order',
        label: 'Bill Total',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.total,
    },
    {
        key: 'payment_method',
        token: '{payment_method}',
        category: 'order',
        label: 'Payment Method',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.payment_method,
    },
    {
        key: 'points_earned',
        token: '{points_earned}',
        category: 'loyalty',
        label: 'Points Earned',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.points_earned,
    },
    {
        key: 'points_balance',
        token: '{points_balance}',
        category: 'loyalty',
        label: 'Points Balance',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.points_balance,
    },
    {
        key: 'points_value',
        token: '{points_value}',
        category: 'loyalty',
        label: 'Points Value',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.points_value,
    },
    {
        key: 'store_name',
        token: '{store_name}',
        category: 'store',
        label: 'Store Name',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.store_name,
    },
    {
        key: 'store_phone',
        token: '{store_phone}',
        category: 'store',
        label: 'Store Phone',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.store_phone,
    },
    {
        key: 'feedback_link',
        token: '{feedback_link}',
        category: 'store',
        label: 'Feedback Link',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.feedback_link,
    },
    {
        key: 'instagram',
        token: '{instagram}',
        category: 'store',
        label: 'Instagram',
        sample: exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT.instagram,
    },
];
const PLACEHOLDER_REGEX = new RegExp(`\\{(${exports.WHATSAPP_PLACEHOLDER_KEYS.join('|')})\\}`, 'g');
/**
 * Pure single-pass placeholder renderer. Values substituted from customer/order
 * records are never re-parsed for `{...}` tokens, preventing template injection.
 */
function renderWhatsAppTemplate(templateBody, context) {
    if (typeof templateBody !== 'string' || !templateBody)
        return '';
    const rendered = templateBody.replace(PLACEHOLDER_REGEX, (_match, key) => {
        const val = context[key];
        if (val === null || val === undefined)
            return '';
        return String(val);
    });
    return rendered
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function buildSampleWhatsAppContext(overrides = {}) {
    const merged = { ...exports.SAMPLE_WHATSAPP_TEMPLATE_CONTEXT };
    for (const key of exports.WHATSAPP_PLACEHOLDER_KEYS) {
        const val = overrides[key];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
            merged[key] = String(val);
        }
    }
    return merged;
}
const TIME_HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function clampInt(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num))
        return fallback;
    return Math.max(min, Math.min(max, Math.round(num)));
}
const VALID_TRIGGER_TYPES = new Set(exports.DEFAULT_WHATSAPP_RULES.map((r) => r.trigger));
function resolveWhatsAppRuleTrigger(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const rec = raw;
    const key = rec.trigger ?? rec.id;
    if (typeof key !== 'string')
        return null;
    const trimmed = key.trim();
    return VALID_TRIGGER_TYPES.has(trimmed)
        ? trimmed
        : null;
}
function normalizeTimeHhMm(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const trimmed = value.trim();
    return TIME_HH_MM_RE.test(trimmed) ? trimmed : fallback;
}
function normalizeWhatsAppAutomationConfig(raw) {
    let candidate = raw;
    if (typeof raw === 'string') {
        try {
            candidate = raw.trim() ? JSON.parse(raw) : {};
        }
        catch {
            candidate = {};
        }
    }
    const parsed = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate
        : {};
    // Normalize templates
    const rawTemplates = Array.isArray(parsed.templates) ? parsed.templates : [];
    const seenTemplateIds = new Set();
    const templates = [];
    for (const item of rawTemplates) {
        if (!item || typeof item !== 'object')
            continue;
        const rec = item;
        const id = String(rec.id ?? '')
            .trim()
            .slice(0, 64);
        const name = String(rec.name ?? '')
            .trim()
            .slice(0, 80);
        const body = String(rec.body ?? '')
            .trim()
            .slice(0, 4000);
        if (!id || !name || !body || seenTemplateIds.has(id))
            continue;
        seenTemplateIds.add(id);
        templates.push({ id, name, body });
        if (templates.length >= 25)
            break;
    }
    for (const def of exports.DEFAULT_WHATSAPP_TEMPLATES) {
        if (!seenTemplateIds.has(def.id)) {
            templates.push({ ...def });
            seenTemplateIds.add(def.id);
        }
    }
    const validTemplateIds = new Set(templates.map((t) => t.id));
    // Normalize rules (one canonical rule per trigger type)
    const rawRules = Array.isArray(parsed.rules) ? parsed.rules : [];
    const ruleByTrigger = new Map();
    for (const r of rawRules) {
        const trigger = resolveWhatsAppRuleTrigger(r);
        if (trigger && !ruleByTrigger.has(trigger)) {
            ruleByTrigger.set(trigger, r);
        }
    }
    const rules = exports.DEFAULT_WHATSAPP_RULES.map((def) => {
        const custom = ruleByTrigger.get(def.trigger);
        const candidateTemplateId = String(custom?.templateId ?? def.templateId).trim();
        const templateId = validTemplateIds.has(candidateTemplateId)
            ? candidateTemplateId
            : def.templateId;
        const rule = {
            id: def.id,
            trigger: def.trigger,
            enabled: typeof custom?.enabled === 'boolean' ? custom.enabled : def.enabled,
            templateId,
        };
        if (def.trigger === 'feedback_delay') {
            rule.delayHours = clampInt(custom?.delayHours, def.delayHours ?? 2, 1, 168);
        }
        else if (def.trigger === 'winback') {
            rule.inactiveDays = clampInt(custom?.inactiveDays, def.inactiveDays ?? 14, 1, 365);
        }
        else if (def.trigger === 'points_threshold') {
            rule.pointsThreshold = clampInt(custom?.pointsThreshold, def.pointsThreshold ?? 100, 1, 1_000_000);
        }
        else if (def.trigger === 'nth_visit') {
            rule.nthVisit = clampInt(custom?.nthVisit, def.nthVisit ?? 5, 1, 1000);
        }
        else if (def.trigger === 'z_report_day_close') {
            rule.recipientPhone =
                typeof custom?.recipientPhone === 'string'
                    ? custom.recipientPhone.trim().slice(0, 32)
                    : (def.recipientPhone ?? '');
        }
        return rule;
    });
    // Normalize safety
    const rawSafety = parsed.safety && typeof parsed.safety === 'object' && !Array.isArray(parsed.safety)
        ? parsed.safety
        : {};
    let feedbackLink = String(rawSafety.feedbackLink ?? exports.DEFAULT_WHATSAPP_SAFETY.feedbackLink)
        .trim()
        .slice(0, 500);
    if (feedbackLink && !/^https:\/\//i.test(feedbackLink)) {
        // Only allow https:// feedback links so Baileys content filter never rejects the template
        if (/^http:\/\//i.test(feedbackLink)) {
            feedbackLink = feedbackLink.replace(/^http:\/\//i, 'https://');
        }
        else if (!feedbackLink.includes('://')) {
            feedbackLink = `https://${feedbackLink}`;
        }
    }
    const safety = {
        autoOptOutEnabled: typeof rawSafety.autoOptOutEnabled === 'boolean'
            ? rawSafety.autoOptOutEnabled
            : exports.DEFAULT_WHATSAPP_SAFETY.autoOptOutEnabled,
        quietHoursEnabled: typeof rawSafety.quietHoursEnabled === 'boolean'
            ? rawSafety.quietHoursEnabled
            : exports.DEFAULT_WHATSAPP_SAFETY.quietHoursEnabled,
        quietHoursStart: normalizeTimeHhMm(rawSafety.quietHoursStart, exports.DEFAULT_WHATSAPP_SAFETY.quietHoursStart),
        quietHoursEnd: normalizeTimeHhMm(rawSafety.quietHoursEnd, exports.DEFAULT_WHATSAPP_SAFETY.quietHoursEnd),
        maxPerCustomerPerWeek: clampInt(rawSafety.maxPerCustomerPerWeek, exports.DEFAULT_WHATSAPP_SAFETY.maxPerCustomerPerWeek, 1, 50),
        feedbackLink,
    };
    return { templates, rules, safety };
}
/**
 * Checks whether an inbound DM body is an opt-out keyword (STOP, UNSUBSCRIBE, OPT OUT, OPTOUT).
 */
function isAutoOptOutText(body) {
    if (typeof body !== 'string')
        return false;
    const cleaned = body
        .trim()
        .replace(/[.!,?]+$/g, '')
        .trim();
    return /^(stop|unsubscribe|opt\s*out)$/i.test(cleaned);
}
/**
 * Evaluates whether `currentHhMm` ('HH:MM') falls inside `[startHhMm, endHhMm)`.
 * Supports overnight windows (e.g. '22:00' to '09:00') and same-day windows.
 * When `endHhMm` is '23:59', the window includes the final minute of the day.
 */
function isTimeWithinQuietHours(currentHhMm, startHhMm, endHhMm) {
    if (!TIME_HH_MM_RE.test(currentHhMm))
        return false;
    const start = normalizeTimeHhMm(startHhMm, '22:00');
    const end = normalizeTimeHhMm(endHhMm, '09:00');
    if (start === end)
        return false;
    if (start < end) {
        return currentHhMm >= start && (end === '23:59' || currentHhMm < end);
    }
    // Overnight window (e.g. 22:00 -> 09:00)
    return currentHhMm >= start || currentHhMm < end;
}
function extractTriggerRule(createdByUserId) {
    if (typeof createdByUserId !== 'string' || !createdByUserId.startsWith('rule:')) {
        return null;
    }
    const rule = createdByUserId.slice(5);
    if (rule === 'after_payment' ||
        rule === 'feedback_delay' ||
        rule === 'winback' ||
        rule === 'points_threshold' ||
        rule === 'nth_visit' ||
        rule === 'z_report_day_close' ||
        rule === 'broadcast') {
        return rule;
    }
    return null;
}
//# sourceMappingURL=whatsapp-automation.js.map