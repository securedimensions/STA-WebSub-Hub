/*
MIT License

Copyright (c) 2024 Secure Dimensions

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

DROP TABLE IF EXISTS topics CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;

CREATE TABLE topics (
    id serial primary key not null,
    topic_url character varying not null,
    topic character varying not null
);
CREATE INDEX idx_topic_url ON topics (topic_url);
CREATE INDEX idx_topic ON topics (topic);

CREATE TABLE subscriptions (
    id serial primary key not null,
    callback character varying not null,
    status character varying,
    topic_id int not null references topics(id),
    duration int,
    secret character varying,
    created timestamp with time zone,
    updated timestamp with time zone
);

DROP VIEW IF EXISTS view_subscriptions;
CREATE OR REPLACE VIEW view_subscriptions AS 
SELECT t.id, topic_url, topic,

    COALESCE(( SELECT json_agg(t_1.*) AS json_agg
           FROM ( SELECT *
                   FROM subscriptions s
                   WHERE s.topic_id = t.id) t_1), '[]'::json) AS "subscriptions"
    FROM topics t;

DROP VIEW IF EXISTS all_subscriptions;
CREATE OR REPLACE VIEW all_subscriptions AS 
SELECT t.id,

    COALESCE(( SELECT json_agg(t_1.*) AS json_agg
           FROM ( SELECT * FROM subscriptions s) t_1), '[]'::json) AS "subscriptions"
    FROM topics t;