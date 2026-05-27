INSERT INTO users (id, username, password_hash, nickname, bio)
VALUES (1, 'demo', 'demo-password-hash', '绵绵', '作业本本地演示用户')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_settings (user_id, theme, share_settings)
VALUES (1, '草莓薄荷', '{"generated": false, "visibility": "link"}'::jsonb)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO diaries (
    id,
    user_id,
    source_type,
    title,
    content,
    summary,
    start_time,
    end_time,
    tags,
    work_priority
)
VALUES
    (
        1,
        1,
        'human',
        '整理 Agent 日记产品方向',
        '确认产品从普通工作日记升级为人类和 Agent 共同写入的工作记忆中心。',
        '确认产品从普通工作日记升级为人类和 Agent 共同写入的工作记忆中心。',
        CURRENT_DATE + TIME '09:20',
        CURRENT_DATE + TIME '10:00',
        ARRAY['产品定位', 'PRD'],
        '高'
    ),
    (
        2,
        1,
        'agent',
        'Agent 回顾了交互内容',
        '提炼出 API Key、Skill 文档、双来源日记和任务时间线四个核心模块。',
        '提炼出 API Key、Skill 文档、双来源日记和任务时间线四个核心模块。',
        CURRENT_DATE + TIME '10:48',
        CURRENT_DATE + TIME '11:20',
        ARRAY['Agent 回顾', '结构化'],
        '中'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO todos (id, user_id, content, status)
VALUES
    (1, 1, '补充 Agent 写入日记接口字段', '待办'),
    (2, 1, '确认分享卡片隐私默认值', '已完成')
ON CONFLICT (id) DO NOTHING;

SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1), true);
SELECT setval('diaries_id_seq', GREATEST((SELECT MAX(id) FROM diaries), 1), true);
SELECT setval('todos_id_seq', GREATEST((SELECT MAX(id) FROM todos), 1), true);
