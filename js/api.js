const GEMINI_MODEL = "gemini-2.5-flash";

async function getGeminiSummary(text) {
    const prompt = `다음 공지를 3줄로 요약해. 각 줄은 '- '로 시작. 명사형 종결.\n\n${text}`;

    try {
        const response = await fetch('/api/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, model: GEMINI_MODEL })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data?.error || 'AI 요약 요청 실패');
        }

        const resultText = data?.text || '';
        const lines = resultText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.replace(/^-+\s*/, '').trim());

        return lines.length > 0
            ? lines.slice(0, 3)
            : ['AI 요약을 생성하지 못했습니다.', '본문을 직접 확인해주세요.', ''];
    } catch (error) {
        console.error('Gemini 요약 실패:', error);
        return [
            'AI 요약 생성 실패',
            error.message || '서버 또는 API 호출 오류',
            '본문을 직접 확인해주세요.'
        ];
    }
}

function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });
}