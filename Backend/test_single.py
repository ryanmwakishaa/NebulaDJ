print("starting")

from dj_audio import analyze_file

print("imported")

result = analyze_file(
    r"songs\Bucie - Easy to Love.mp3"
)

print("analyzed")

print(result)