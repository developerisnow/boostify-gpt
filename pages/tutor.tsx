import { useState, useRef } from "react";
import type { NextPage } from "next";
import { Textarea, TextInput, Button, Group, Stack } from "@mantine/core";

const defaultPrompt =
  "You are a friendly Russian language tutor. Explain the chosen topic in Russian, then ask the student to rephrase the rule. Offer subtle hints that guide toward the correct understanding without revealing the full answer.";

const Tutor: NextPage = () => {
  const [apiKey, setApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(defaultPrompt);
  const [topic, setTopic] = useState("");
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const [userMessage, setUserMessage] = useState("");
  const [testQuestions, setTestQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [testResult, setTestResult] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const startSession = async () => {
    if (!apiKey) return;
    const connection = new RTCPeerConnection();
    setPc(connection);
    dataChannel.current = connection.createDataChannel("oai-events");

    const local = await navigator.mediaDevices.getUserMedia({ audio: true });
    local.getTracks().forEach((t) => connection.addTrack(t, local));

    connection.ontrack = (e) => {
      if (audioRef.current) {
        audioRef.current.srcObject = e.streams[0];
      }
    };

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    const res = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-02",
      {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
      }
    );
    const answer = await res.text();
    await connection.setRemoteDescription({
      type: "answer",
      sdp: answer,
    } as RTCSessionDescriptionInit);

    dataChannel.current.addEventListener("open", () => {
      dataChannel.current?.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: `${systemPrompt}\nТема: ${topic}`,
          },
        })
      );
    });
  };

  const stopSession = () => {
    pc?.close();
    setPc(null);
  };

  const sendMessage = () => {
    if (!dataChannel.current || !userMessage) return;
    dataChannel.current.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: userMessage }],
        },
      })
    );
    dataChannel.current.send(JSON.stringify({ type: "response.create" }));
    setUserMessage("");
  };

  const generateTest = async () => {
    if (!apiKey) return;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\nСоставь короткий тест из трех вопросов по теме: ${topic}. Ответы не предоставляй.`,
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const questions = text
      .split("\n")
      .map((q: string) => q.trim())
      .filter(Boolean);
    setTestQuestions(questions);
    setAnswers(Array(questions.length).fill(""));
    setTestResult("");
  };

  const submitTest = async () => {
    if (!apiKey) return;
    const qa = testQuestions
      .map((q, i) => `${q}\nОтвет: ${answers[i]}`)
      .join("\n\n");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Проверь ответы ученика по теме: ${topic}.\n${qa}\nДай отзыв на русском.`,
          },
        ],
      }),
    });
    const data = await res.json();
    setTestResult(data.choices?.[0]?.message?.content || "");
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ width: "30%", padding: 16, borderRight: "1px solid #ccc" }}>
        <Textarea
          label="System prompt"
          minRows={20}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.currentTarget.value)}
        />
      </div>
      <div style={{ flex: 1, padding: 16 }}>
        <Stack spacing="sm">
          <TextInput
            label="OpenAI API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
          />
          <TextInput
            label="Тема для изучения"
            value={topic}
            onChange={(e) => setTopic(e.currentTarget.value)}
          />
          <Group>
            <Button onClick={startSession} disabled={!!pc}>
              Start tutor
            </Button>
            <Button onClick={stopSession} disabled={!pc} color="red">
              Stop
            </Button>
          </Group>
          <audio ref={audioRef} autoPlay />
          <TextInput
            label="Ваш ответ"
            value={userMessage}
            onChange={(e) => setUserMessage(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <Button onClick={sendMessage} disabled={!userMessage}>
            Отправить
          </Button>
          <Button onClick={generateTest}>Сгенерировать тест</Button>
          {testQuestions.map((q, i) => (
            <TextInput
              key={i}
              label={q}
              value={answers[i]}
              onChange={(e) => {
                const newAnswers = [...answers];
                newAnswers[i] = e.currentTarget.value;
                setAnswers(newAnswers);
              }}
            />
          ))}
          {testQuestions.length > 0 && (
            <Button onClick={submitTest}>Проверить ответы</Button>
          )}
          {testResult && <Textarea label="Результат" value={testResult} />}
        </Stack>
      </div>
    </div>
  );
};

export default Tutor;
