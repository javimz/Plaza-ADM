"""
CLI script to run automated alert dispatches via Cron or directly.
Example crontab entry (daily at 9:00 AM):
0 9 * * * cd /var/www/adm-app && ./venv/bin/python send_alerts_cron.py >> /var/log/plaza_alerts_cron.log 2>&1
"""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.routers.notifications import run_automated_alerts_check

if __name__ == "__main__":
    start_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{start_time}] Starting automated push alerts check...")
    try:
        sent = run_automated_alerts_check()
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Done. Notifications sent: {sent}")
    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: {e}")
