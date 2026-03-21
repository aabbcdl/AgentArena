import os  
file_path = r"D:\project\AgentArena\examples\taskpacks\official\config-repair.yaml"  
with open(file_path, "r", encoding="utf-8") as f:  
    lines = f.readlines()  
print("Total lines:", len(lines)) 
