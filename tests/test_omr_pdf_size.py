import pymupdf as fitz
from backend.main import omr_safe_pdf


def test_oversized_pdf_is_rescaled_without_cropping():
    doc = fitz.open()
    page = doc.new_page(width=1280, height=1400)
    page.insert_text((100, 100), 'score marker')
    original = doc.tobytes()
    doc.close()
    result = omr_safe_pdf(original)
    with fitz.open(stream=result, filetype='pdf') as converted:
        page = converted[0]
        assert page.rect.width < 1280
        assert abs(page.rect.width / page.rect.height - 1280 / 1400) < 0.001
        assert 'score marker' in page.get_text()
        assert page.rect.width * page.rect.height * (300 / 72) ** 2 <= 8_000_100


def test_normal_pdf_is_left_unchanged():
    doc = fitz.open()
    doc.new_page(width=500, height=700)
    data = doc.tobytes()
    doc.close()
    assert omr_safe_pdf(data) == data



def test_omr_timeout_gives_clear_fallback(monkeypatch):
    import subprocess
    import backend.main as main
    from fastapi.testclient import TestClient
    monkeypatch.setenv('AUDIVERIS_BIN', 'fake-engine')
    def timeout(args):
        raise subprocess.TimeoutExpired(args, 1200)
    monkeypatch.setattr(main, 'run_omr', timeout)
    doc = fitz.open()
    page = doc.new_page(width=500, height=700)
    page.insert_text((50, 50), 'score')
    data = doc.tobytes()
    doc.close()
    response = TestClient(main.app).post('/api/import', files={'file': ('score.pdf', data, 'application/pdf')})
    assert response.status_code == 200
    score = response.json()
    assert score['measures'][0]['notes'] == []
    assert any('超过 20 分钟' in warning for warning in score['warnings'])
