from openai import OpenAI
from dotenv import load_dotenv
from pathlib import Path
import os

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

print(os.getenv("OPENAI_API_KEY"))

api_key = os.getenv("OPENAI_API_KEY")
print("KEY LOADED?", api_key is not None)
print("KEY STARTS WITH:", api_key[:8] if api_key else None)

client = OpenAI(api_key=api_key)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

quiz_answers = """
I like dark stories, mystery, emotional characters, plot twists, and suspense.
I prefer books that are not too hard but still interesting.
"""

books_read = "The Silent Patient, Verity"
reading_level = "Intermediate"

prompt = f"""
Analyze this reader profile.

Quiz answers:
{quiz_answers}

Books already read:
{books_read}

Reading level:
{reading_level}

Return:
1. Reader type
2. Favorite genres
3. Confirmed reading level
4. Book preferences
5. Five book recommendations
6. Reason for each recommendation
"""

response = client.responses.create(
    model="gpt-4.1-mini",
    input=prompt
)

print(response.output_text)